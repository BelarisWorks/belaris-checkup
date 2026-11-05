<?php
/**
 * Leads: stored as a private post type, shown under "Checkup Leads" in the dashboard,
 * exportable to CSV, emailed to you, and optionally sent to a webhook (e.g. Zapier → SuiteDash).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function belaris_checkup_register_lead_type() {
	register_post_type( 'belaris_lead', array(
		'labels'          => array(
			'name'          => 'Checkup Leads',
			'singular_name' => 'Checkup Lead',
			'menu_name'     => 'Checkup Leads',
			'all_items'     => 'All Leads',
			'edit_item'     => 'Lead',
			'search_items'  => 'Search Leads',
			'not_found'     => 'No leads yet. They appear here when someone completes the checkup.',
		),
		'public'          => false,
		'show_ui'         => true,
		'show_in_menu'    => true,
		'show_in_rest'    => false,
		'menu_icon'       => 'dashicons-chart-bar',
		'menu_position'   => 26,
		'supports'        => array( 'title' ),
		'capability_type' => 'post',
		'capabilities'    => array( 'create_posts' => 'do_not_allow' ),
		'map_meta_cap'    => true,
	) );
}
add_action( 'init', 'belaris_checkup_register_lead_type' );

/** Creates the lead record. Returns the post ID or 0. */
function belaris_checkup_save_lead( $lead, $result ) {
	$title = trim( ( $lead['business'] ? $lead['business'] : wp_parse_url( $lead['url'], PHP_URL_HOST ) ) . ' – ' . $lead['email'] );
	$post_id = wp_insert_post( array(
		'post_type'   => 'belaris_lead',
		'post_status' => 'publish',
		'post_title'  => $title,
	), true );
	if ( is_wp_error( $post_id ) ) {
		return 0;
	}
	$weak = array();
	foreach ( (array) ( isset( $result['items'] ) ? $result['items'] : array() ) as $item ) {
		if ( isset( $item['status'] ) && 'bad' === $item['status'] ) {
			$weak[] = $item['topic'];
		}
	}
	$meta = array(
		'_bc_name'        => $lead['name'],
		'_bc_email'       => $lead['email'],
		'_bc_consent'     => $lead['consent'] ? 1 : 0,
		'_bc_business'    => $lead['business'],
		'_bc_town'        => $lead['town'],
		'_bc_url'         => $lead['url'],
		'_bc_platform'    => isset( $result['scanned']['platform'] ) ? sanitize_text_field( (string) $result['scanned']['platform'] ) : '',
		'_bc_score'       => isset( $result['score'] ) ? (int) $result['score'] : 0,
		'_bc_band'        => isset( $result['band']['label'] ) ? sanitize_text_field( $result['band']['label'] ) : '',
		'_bc_steps'       => implode( ' | ', array_map( function ( $s ) { return sanitize_text_field( $s['title'] ); }, (array) $result['steps'] ) ),
		'_bc_weak'        => implode( ', ', array_map( 'sanitize_text_field', $weak ) ),
		'_bc_a11y_issues' => isset( $result['accessibility']['issues'] ) ? count( $result['accessibility']['issues'] ) : '',
		'_bc_result'      => wp_json_encode( $result ),
	);
	foreach ( $meta as $k => $v ) {
		update_post_meta( $post_id, $k, $v );
	}
	return $post_id;
}

/** Emails and webhook after a lead is saved. */
function belaris_checkup_after_lead( $post_id, $result ) {
	$m = function ( $k ) use ( $post_id ) { return get_post_meta( $post_id, $k, true ); };

	// 1) Alert to you
	$to = belaris_checkup_get( 'notify_email' );
	if ( is_email( $to ) ) {
		$lines = array(
			'New website checkup lead',
			'',
			'Name:      ' . $m( '_bc_name' ),
			'Email:     ' . $m( '_bc_email' ),
			'Business:  ' . $m( '_bc_business' ) . ( $m( '_bc_town' ) ? ' (' . $m( '_bc_town' ) . ')' : '' ),
			'Website:   ' . $m( '_bc_url' ) . ( $m( '_bc_platform' ) ? ' – built with ' . $m( '_bc_platform' ) : '' ),
			'Score:     ' . $m( '_bc_score' ) . '/100 (' . $m( '_bc_band' ) . ')',
			'Weakest:   ' . ( $m( '_bc_weak' ) ? $m( '_bc_weak' ) : 'none' ),
			'Next steps we gave them: ' . $m( '_bc_steps' ),
			'OK to follow up with tips: ' . ( $m( '_bc_consent' ) ? 'Yes' : 'No (only contact them about these results)' ),
			'',
			'Full details: ' . admin_url( 'post.php?post=' . $post_id . '&action=edit' ),
		);
		wp_mail( $to, 'New checkup lead: ' . $m( '_bc_business' ) . ' scored ' . $m( '_bc_score' ), implode( "\n", $lines ),
			array( 'Reply-To: ' . $m( '_bc_email' ) ) );
	}

	// 2) Copy of results to the visitor
	if ( belaris_checkup_get( 'visitor_email' ) ) {
		wp_mail( $m( '_bc_email' ), 'Your website checkup: ' . $m( '_bc_score' ) . '/100',
			belaris_checkup_visitor_email( $result, $m( '_bc_name' ), $m( '_bc_url' ) ),
			array( 'Content-Type: text/html; charset=UTF-8' ) );
	}

	// 3) Webhook (Zapier / Make → SuiteDash or any CRM)
	$hook = belaris_checkup_get( 'webhook_url' );
	if ( $hook ) {
		wp_remote_post( $hook, array(
			'timeout'  => 5,
			'blocking' => false,
			'headers'  => array( 'Content-Type' => 'application/json' ),
			'body'     => wp_json_encode( array(
				'name'          => $m( '_bc_name' ),
				'email'         => $m( '_bc_email' ),
				'business'      => $m( '_bc_business' ),
				'town'          => $m( '_bc_town' ),
				'website'       => $m( '_bc_url' ),
				'platform'      => $m( '_bc_platform' ),
				'score'         => (int) $m( '_bc_score' ),
				'band'          => $m( '_bc_band' ),
				'weak_areas'    => $m( '_bc_weak' ),
				'next_steps'    => $m( '_bc_steps' ),
				'a11y_issues'   => $m( '_bc_a11y_issues' ),
				'marketing_ok'  => (bool) $m( '_bc_consent' ),
				'submitted_at'  => get_post_time( 'c', true, $post_id ),
			) ),
		) );
	}
}

function belaris_checkup_visitor_email( $r, $name, $url ) {
	$e     = 'esc_html';
	$steps = '';
	foreach ( (array) $r['steps'] as $i => $s ) {
		$steps .= '<tr><td style="padding:12px 0;border-top:1px solid #D6DCE8;vertical-align:top">'
			. '<strong style="font-size:16px">' . ( $i + 1 ) . '. ' . $e( $s['title'] ) . '</strong><br>'
			. '<span style="color:#4E5873">' . $e( $s['why'] ) . '</span><br>'
			. '<strong>First step:</strong> ' . $e( $s['step'] ) . '</td></tr>';
	}
	$book  = belaris_checkup_get( 'booking_url' );
	$hello = $name ? 'Hi ' . $e( $name ) . ',' : 'Hi,';
	return '<div style="font-family:Arial,Helvetica,sans-serif;color:#141A2E;max-width:560px;margin:0 auto;line-height:1.5">'
		. '<p>' . $hello . '</p>'
		. '<p>Here are the results of the website checkup for <strong>' . $e( wp_parse_url( $url, PHP_URL_HOST ) ) . '</strong>.</p>'
		. '<p style="font-size:40px;font-weight:bold;margin:8px 0">' . (int) $r['score'] . '<span style="font-size:16px;color:#4E5873"> / 100</span></p>'
		. '<p><strong>' . $e( $r['band']['label'] ) . '.</strong> ' . $e( $r['band']['summary'] ) . '</p>'
		. '<h2 style="font-size:18px;margin-top:24px">Your three next steps</h2>'
		. '<table role="presentation" style="width:100%;border-collapse:collapse">' . $steps . '</table>'
		. ( $book ? '<p style="margin-top:24px"><a href="' . esc_url( $book ) . '" style="background:#2B4ACB;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Book a free review</a></p>' : '' )
		. '<p style="color:#4E5873;font-size:13px;margin-top:24px">You received this because you ran a website checkup on ' . $e( wp_parse_url( home_url(), PHP_URL_HOST ) ) . '.</p>'
		. '</div>';
}

/* ---------- Dashboard list and detail screen ---------- */

add_filter( 'manage_belaris_lead_posts_columns', function () {
	return array(
		'cb'       => '<input type="checkbox">',
		'title'    => 'Lead',
		'bc_web'   => 'Website',
		'bc_score' => 'Score',
		'bc_weak'  => 'Weakest areas',
		'bc_ok'    => 'OK to market',
		'date'     => 'Date',
	);
} );

add_action( 'manage_belaris_lead_posts_custom_column', function ( $col, $post_id ) {
	switch ( $col ) {
		case 'bc_web':
			$u = get_post_meta( $post_id, '_bc_url', true );
			echo $u ? '<a href="' . esc_url( $u ) . '" target="_blank" rel="noopener noreferrer">' . esc_html( wp_parse_url( $u, PHP_URL_HOST ) ) . '</a>' : '';
			break;
		case 'bc_score':
			echo esc_html( get_post_meta( $post_id, '_bc_score', true ) . ' – ' . get_post_meta( $post_id, '_bc_band', true ) );
			break;
		case 'bc_weak':
			echo esc_html( get_post_meta( $post_id, '_bc_weak', true ) );
			break;
		case 'bc_ok':
			echo get_post_meta( $post_id, '_bc_consent', true ) ? 'Yes' : 'No';
			break;
	}
}, 10, 2 );

add_action( 'add_meta_boxes_belaris_lead', function () {
	remove_meta_box( 'submitdiv', 'belaris_lead', 'side' );
	add_meta_box( 'bc_details', 'Lead details', 'belaris_checkup_lead_box', 'belaris_lead', 'normal', 'high' );
} );

function belaris_checkup_lead_box( $post ) {
	$g    = function ( $k ) use ( $post ) { return get_post_meta( $post->ID, $k, true ); };
	$rows = array(
		'Name'            => $g( '_bc_name' ),
		'Email'           => $g( '_bc_email' ),
		'Business'        => $g( '_bc_business' ),
		'Town'            => $g( '_bc_town' ),
		'Website'         => $g( '_bc_url' ),
		'Built with'      => $g( '_bc_platform' ),
		'Score'           => $g( '_bc_score' ) . '/100 – ' . $g( '_bc_band' ),
		'Weakest areas'   => $g( '_bc_weak' ),
		'Next steps given'=> $g( '_bc_steps' ),
		'Accessibility issue types' => $g( '_bc_a11y_issues' ),
		'OK to market'    => $g( '_bc_consent' ) ? 'Yes' : 'No',
	);
	echo '<table class="widefat striped"><tbody>';
	foreach ( $rows as $label => $val ) {
		echo '<tr><th style="width:200px">' . esc_html( $label ) . '</th><td>' . esc_html( (string) $val ) . '</td></tr>';
	}
	echo '</tbody></table>';
	$r = json_decode( (string) $g( '_bc_result' ), true );
	if ( is_array( $r ) && ! empty( $r['items'] ) ) {
		echo '<h3>Area by area</h3><table class="widefat striped"><tbody>';
		foreach ( $r['items'] as $i ) {
			$ev = isset( $i['evidence'] ) ? implode( ' ', (array) $i['evidence'] ) : '';
			if ( ! empty( $i['answer'] ) ) {
				$ev = 'Answered: "' . $i['answer'] . '". ' . $ev;
			}
			echo '<tr><th style="width:200px">' . esc_html( $i['topic'] ) . '</th><td>' . esc_html( ucfirst( (string) $i['status'] ) ) . '</td><td>' . esc_html( $ev ) . '</td></tr>';
		}
		echo '</tbody></table>';
	}
}

/* ---------- CSV export ---------- */

add_action( 'restrict_manage_posts', function ( $post_type ) {
	if ( 'belaris_lead' !== $post_type ) {
		return;
	}
	$url = wp_nonce_url( admin_url( 'admin-post.php?action=belaris_checkup_export' ), 'belaris_checkup_export' );
	echo '<a class="button" href="' . esc_url( $url ) . '">Export all to CSV</a>';
} );

add_action( 'admin_post_belaris_checkup_export', function () {
	if ( ! current_user_can( 'edit_posts' ) || ! check_admin_referer( 'belaris_checkup_export' ) ) {
		wp_die( 'Not allowed.' );
	}
	$ids = get_posts( array( 'post_type' => 'belaris_lead', 'numberposts' => -1, 'fields' => 'ids', 'post_status' => 'any' ) );
	nocache_headers();
	header( 'Content-Type: text/csv; charset=utf-8' );
	header( 'Content-Disposition: attachment; filename=checkup-leads-' . gmdate( 'Y-m-d' ) . '.csv' );
	$out  = fopen( 'php://output', 'w' );
	$cols = array( 'Date', 'Name', 'Email', 'Business', 'Town', 'Website', 'Platform', 'Score', 'Band', 'Weakest areas', 'Next steps', 'OK to market' );
	fputcsv( $out, $cols );
	$safe = function ( $v ) { // stop spreadsheet formula injection
		$v = (string) $v;
		return preg_match( '/^[=+\-@\t\r]/', $v ) ? "'" . $v : $v;
	};
	foreach ( $ids as $id ) {
		$g = function ( $k ) use ( $id ) { return get_post_meta( $id, $k, true ); };
		fputcsv( $out, array_map( $safe, array(
			get_the_date( 'Y-m-d H:i', $id ), $g( '_bc_name' ), $g( '_bc_email' ), $g( '_bc_business' ), $g( '_bc_town' ),
			$g( '_bc_url' ), $g( '_bc_platform' ), $g( '_bc_score' ), $g( '_bc_band' ), $g( '_bc_weak' ), $g( '_bc_steps' ),
			$g( '_bc_consent' ) ? 'Yes' : 'No',
		) ) );
	}
	fclose( $out );
	exit;
} );
