<?php
/**
 * [belaris_checkup] shortcode
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'wp_enqueue_scripts', function () {
	wp_register_style( 'belaris-checkup', BELARIS_CHECKUP_URL . 'assets/checkup.css', array(), BELARIS_CHECKUP_VERSION );
	wp_register_script( 'belaris-checkup', BELARIS_CHECKUP_URL . 'assets/checkup.js', array(), BELARIS_CHECKUP_VERSION, true );
} );

add_shortcode( 'belaris_checkup', function () {
	wp_enqueue_style( 'belaris-checkup' );
	wp_enqueue_script( 'belaris-checkup' );
	wp_add_inline_script( 'belaris-checkup', 'window.BELARIS_CHECKUP = ' . wp_json_encode( array(
		'rest'       => esc_url_raw( rest_url( 'belaris-checkup/v1/' ) ),
		'bookingUrl' => esc_url_raw( belaris_checkup_get( 'booking_url' ) ),
	) ) . ';', 'before' );
	$privacy = belaris_checkup_get( 'privacy_url' );
	ob_start();
	include BELARIS_CHECKUP_DIR . 'templates/checkup.php';
	return ob_get_clean();
} );
