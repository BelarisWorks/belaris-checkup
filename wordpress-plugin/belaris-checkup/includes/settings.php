<?php
/**
 * Settings → Website Checkup
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function belaris_checkup_defaults() {
	return array(
		'scanner_url'   => '',
		'api_key'       => '',
		'notify_email'  => get_option( 'admin_email' ),
		'booking_url'   => home_url( '/contact/' ),
		'privacy_url'   => function_exists( 'get_privacy_policy_url' ) ? get_privacy_policy_url() : '',
		'visitor_email' => 1,
		'webhook_url'   => '',
	);
}

/** Returns one setting. The API key can also live in wp-config.php as BELARIS_CHECKUP_API_KEY. */
function belaris_checkup_get( $key ) {
	if ( 'api_key' === $key && defined( 'BELARIS_CHECKUP_API_KEY' ) ) {
		return BELARIS_CHECKUP_API_KEY;
	}
	if ( 'scanner_url' === $key && defined( 'BELARIS_CHECKUP_SCANNER_URL' ) ) {
		return BELARIS_CHECKUP_SCANNER_URL;
	}
	$opts = wp_parse_args( (array) get_option( 'belaris_checkup_settings', array() ), belaris_checkup_defaults() );
	return isset( $opts[ $key ] ) ? $opts[ $key ] : null;
}

function belaris_checkup_sanitize_settings( $in ) {
	$in  = is_array( $in ) ? $in : array();
	$old = wp_parse_args( (array) get_option( 'belaris_checkup_settings', array() ), belaris_checkup_defaults() );
	$out = array(
		'scanner_url'   => esc_url_raw( untrailingslashit( trim( isset( $in['scanner_url'] ) ? $in['scanner_url'] : '' ) ), array( 'https', 'http' ) ),
		'notify_email'  => sanitize_email( isset( $in['notify_email'] ) ? $in['notify_email'] : '' ),
		'booking_url'   => esc_url_raw( isset( $in['booking_url'] ) ? $in['booking_url'] : '' ),
		'privacy_url'   => esc_url_raw( isset( $in['privacy_url'] ) ? $in['privacy_url'] : '' ),
		'visitor_email' => empty( $in['visitor_email'] ) ? 0 : 1,
		'webhook_url'   => esc_url_raw( isset( $in['webhook_url'] ) ? $in['webhook_url'] : '', array( 'https' ) ),
		// A blank key field keeps the saved key, so it is never shown back in the form.
		'api_key'       => ( isset( $in['api_key'] ) && '' !== trim( $in['api_key'] ) ) ? sanitize_text_field( $in['api_key'] ) : $old['api_key'],
	);
	return $out;
}

add_action( 'admin_init', function () {
	register_setting( 'belaris_checkup', 'belaris_checkup_settings', array(
		'type'              => 'array',
		'sanitize_callback' => 'belaris_checkup_sanitize_settings',
		'default'           => belaris_checkup_defaults(),
	) );
} );

add_action( 'admin_menu', function () {
	add_options_page( 'Website Checkup', 'Website Checkup', 'manage_options', 'belaris-checkup', 'belaris_checkup_settings_page' );
} );

function belaris_checkup_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$o         = wp_parse_args( (array) get_option( 'belaris_checkup_settings', array() ), belaris_checkup_defaults() );
	$key_const = defined( 'BELARIS_CHECKUP_API_KEY' );
	$health    = belaris_checkup_health();
	?>
	<div class="wrap">
		<h1>Website Checkup</h1>
		<p>Add <code>[belaris_checkup]</code> to any page to show the checkup. Leads appear under <a href="<?php echo esc_url( admin_url( 'edit.php?post_type=belaris_lead' ) ); ?>">Checkup Leads</a>.</p>

		<div class="notice <?php echo $health['ok'] ? 'notice-success' : 'notice-warning'; ?> inline"><p><strong>Scanner:</strong> <?php echo esc_html( $health['message'] ); ?></p></div>

		<form method="post" action="options.php">
			<?php settings_fields( 'belaris_checkup' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="bc-scanner">Scanner address</label></th>
					<td><input type="url" id="bc-scanner" class="regular-text" name="belaris_checkup_settings[scanner_url]" value="<?php echo esc_attr( $o['scanner_url'] ); ?>" placeholder="https://belaris-checkup.onrender.com">
					<p class="description">The address of the scanning server you deployed.</p></td>
				</tr>
				<tr>
					<th scope="row"><label for="bc-key">Scanner key</label></th>
					<td>
					<?php if ( $key_const ) : ?>
						<p>Set in wp-config.php.</p>
					<?php else : ?>
						<input type="password" id="bc-key" class="regular-text" name="belaris_checkup_settings[api_key]" value="" autocomplete="new-password" placeholder="<?php echo $o['api_key'] ? esc_attr__( 'Saved. Leave blank to keep it.', 'belaris-checkup' ) : ''; ?>">
						<p class="description">Must match <code>CHECKUP_API_KEY</code> on the scanning server.</p>
					<?php endif; ?>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="bc-notify">Send new-lead alerts to</label></th>
					<td><input type="email" id="bc-notify" class="regular-text" name="belaris_checkup_settings[notify_email]" value="<?php echo esc_attr( $o['notify_email'] ); ?>"></td>
				</tr>
				<tr>
					<th scope="row">Email visitors their results</th>
					<td><label><input type="checkbox" name="belaris_checkup_settings[visitor_email]" value="1" <?php checked( $o['visitor_email'], 1 ); ?>> Send each visitor a copy of their score and next steps</label></td>
				</tr>
				<tr>
					<th scope="row"><label for="bc-book">"Book a free review" link</label></th>
					<td><input type="url" id="bc-book" class="regular-text" name="belaris_checkup_settings[booking_url]" value="<?php echo esc_attr( $o['booking_url'] ); ?>"></td>
				</tr>
				<tr>
					<th scope="row"><label for="bc-privacy">Privacy policy link</label></th>
					<td><input type="url" id="bc-privacy" class="regular-text" name="belaris_checkup_settings[privacy_url]" value="<?php echo esc_attr( $o['privacy_url'] ); ?>">
					<p class="description">Shown under the email form.</p></td>
				</tr>
				<tr>
					<th scope="row"><label for="bc-hook">Send leads to (webhook)</label></th>
					<td><input type="url" id="bc-hook" class="regular-text" name="belaris_checkup_settings[webhook_url]" value="<?php echo esc_attr( $o['webhook_url'] ); ?>" placeholder="https://hooks.zapier.com/...">
					<p class="description">Optional. Each new lead is sent here as JSON, for example a Zapier or Make hook that creates a contact in SuiteDash.</p></td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
	</div>
	<?php
}

/** Quick check that the scanner is reachable, shown on the settings page. */
function belaris_checkup_health() {
	$base = belaris_checkup_get( 'scanner_url' );
	if ( ! $base ) {
		return array( 'ok' => false, 'message' => 'Not set up yet. Enter the scanner address below.' );
	}
	$res = wp_remote_get( $base . '/health', array( 'timeout' => 8 ) );
	if ( is_wp_error( $res ) ) {
		return array( 'ok' => false, 'message' => 'Could not reach it: ' . $res->get_error_message() );
	}
	if ( 200 !== wp_remote_retrieve_response_code( $res ) ) {
		return array( 'ok' => false, 'message' => 'It answered with error ' . wp_remote_retrieve_response_code( $res ) . '.' );
	}
	return array( 'ok' => true, 'message' => 'Connected.' );
}
