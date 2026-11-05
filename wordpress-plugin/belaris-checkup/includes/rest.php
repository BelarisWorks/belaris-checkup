<?php
/**
 * Public REST routes used by the checkup page. WordPress passes requests to the
 * scanning server with the secret key, so the key never reaches the browser.
 *
 *   POST /wp-json/belaris-checkup/v1/scan         { url, business, town }
 *   GET  /wp-json/belaris-checkup/v1/scan/{id}
 *   POST /wp-json/belaris-checkup/v1/report       { id, answers, lead: { name, email, consent }, website_confirm }
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'belaris-checkup/v1', '/scan', array(
		'methods'             => 'POST',
		'callback'            => 'belaris_checkup_rest_scan',
		'permission_callback' => '__return_true', // public form; abuse is limited by the scanner's per-visitor rate limits
	) );
	register_rest_route( 'belaris-checkup/v1', '/scan/(?P<id>[a-f0-9]{24})', array(
		'methods'             => 'GET',
		'callback'            => 'belaris_checkup_rest_status',
		'permission_callback' => '__return_true',
	) );
	register_rest_route( 'belaris-checkup/v1', '/report', array(
		'methods'             => 'POST',
		'callback'            => 'belaris_checkup_rest_report',
		'permission_callback' => '__return_true',
	) );
} );

function belaris_checkup_error( $message, $status ) {
	return new WP_REST_Response( array( 'error' => $message ), $status );
}

/** Calls the scanning server. Returns array( status, body ) or a WP_REST_Response error. */
function belaris_checkup_call( $method, $path, $body = null, $timeout = 15 ) {
	$base = belaris_checkup_get( 'scanner_url' );
	if ( ! $base ) {
		return belaris_checkup_error( 'The website checkup is not set up yet. Please try again later.', 503 );
	}
	$args = array(
		'method'  => $method,
		'timeout' => $timeout,
		'headers' => array(
			'Content-Type'  => 'application/json',
			'X-Belaris-Key' => (string) belaris_checkup_get( 'api_key' ),
			'X-Visitor-IP'  => isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '',
		),
	);
	if ( null !== $body ) {
		$args['body'] = wp_json_encode( $body );
	}
	$res = wp_remote_request( $base . $path, $args );
	if ( is_wp_error( $res ) ) {
		return belaris_checkup_error( 'We could not reach our checkup service. Please try again in a minute.', 502 );
	}
	$code = (int) wp_remote_retrieve_response_code( $res );
	$data = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( ! is_array( $data ) ) {
		return belaris_checkup_error( 'Our checkup service sent an unexpected reply. Please try again.', 502 );
	}
	if ( 401 === $code ) {
		return belaris_checkup_error( 'The website checkup is not set up correctly yet. Please try again later.', 503 );
	}
	return array( $code, $data );
}

function belaris_checkup_rest_scan( WP_REST_Request $req ) {
	$url      = substr( trim( (string) $req->get_param( 'url' ) ), 0, 300 );
	$business = sanitize_text_field( substr( (string) $req->get_param( 'business' ), 0, 120 ) );
	$town     = sanitize_text_field( substr( (string) $req->get_param( 'town' ), 0, 80 ) );
	$r        = belaris_checkup_call( 'POST', '/api/scan', array( 'url' => $url, 'business' => $business, 'town' => $town ) );
	if ( $r instanceof WP_REST_Response ) {
		return $r;
	}
	list( $code, $data ) = $r;
	if ( 202 === $code && ! empty( $data['id'] ) && preg_match( '/^[a-f0-9]{24}$/', $data['id'] ) ) {
		// Remember what was scanned so the lead record can include it later.
		set_transient( 'belaris_scan_' . $data['id'], array(
			'url'      => isset( $data['url'] ) ? esc_url_raw( $data['url'] ) : '',
			'business' => $business,
			'town'     => $town,
		), 3 * HOUR_IN_SECONDS );
	}
	return new WP_REST_Response( $data, $code );
}

function belaris_checkup_rest_status( WP_REST_Request $req ) {
	$r = belaris_checkup_call( 'GET', '/api/scan/' . $req['id'], null, 10 );
	if ( $r instanceof WP_REST_Response ) {
		return $r;
	}
	return new WP_REST_Response( $r[1], $r[0] );
}

function belaris_checkup_rest_report( WP_REST_Request $req ) {
	if ( '' !== (string) $req->get_param( 'website_confirm' ) ) {
		return belaris_checkup_error( 'Invalid request.', 400 ); // honeypot field filled in by a bot
	}
	$id   = (string) $req->get_param( 'id' );
	$scan = preg_match( '/^[a-f0-9]{24}$/', $id ) ? get_transient( 'belaris_scan_' . $id ) : false;
	if ( ! $scan ) {
		return belaris_checkup_error( 'That check has expired. Please start again.', 404 );
	}
	$lead  = (array) $req->get_param( 'lead' );
	$email = sanitize_email( isset( $lead['email'] ) ? $lead['email'] : '' );
	if ( ! is_email( $email ) ) {
		return new WP_REST_Response( array( 'error' => 'Enter a valid email address so we can send your report.', 'field' => 'email' ), 400 );
	}
	$name    = sanitize_text_field( isset( $lead['name'] ) ? substr( $lead['name'], 0, 120 ) : '' );
	$consent = ! empty( $lead['consent'] ) && true === $lead['consent'];
	$answers = array();
	foreach ( (array) $req->get_param( 'answers' ) as $k => $v ) {
		if ( preg_match( '/^[a-z]{2,20}$/', (string) $k ) && is_int( $v ) && $v >= 0 && $v < 10 ) {
			$answers[ $k ] = $v;
		}
	}

	$r = belaris_checkup_call( 'POST', '/api/report', array(
		'id'      => $id,
		'answers' => (object) $answers,
		'lead'    => array( 'name' => $name, 'email' => $email, 'consent' => $consent ),
	), 25 );
	if ( $r instanceof WP_REST_Response ) {
		return $r;
	}
	list( $code, $result ) = $r;
	if ( 200 !== $code ) {
		return new WP_REST_Response( $result, $code );
	}

	// Save each scan only once, even if the visitor submits twice.
	$lead_id = get_transient( 'belaris_lead_' . $id );
	if ( ! $lead_id ) {
		$lead_id = belaris_checkup_save_lead( array(
			'name'     => $name,
			'email'    => $email,
			'consent'  => $consent,
			'url'      => $scan['url'],
			'business' => $scan['business'],
			'town'     => $scan['town'],
		), $result );
		if ( $lead_id ) {
			set_transient( 'belaris_lead_' . $id, $lead_id, 3 * HOUR_IN_SECONDS );
			belaris_checkup_after_lead( $lead_id, $result );
		}
	}
	return new WP_REST_Response( $result, 200 );
}
