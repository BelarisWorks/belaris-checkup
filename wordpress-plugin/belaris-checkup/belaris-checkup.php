<?php
/**
 * Plugin Name:       Belaris Website Checkup
 * Description:       Free website checkup for small business owners. Add [belaris_checkup] to any page. Leads appear under "Checkup Leads".
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Belaris
 * License:           Proprietary
 * Text Domain:       belaris-checkup
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'BELARIS_CHECKUP_VERSION', '0.1.0' );
define( 'BELARIS_CHECKUP_FILE', __FILE__ );
define( 'BELARIS_CHECKUP_DIR', plugin_dir_path( __FILE__ ) );
define( 'BELARIS_CHECKUP_URL', plugin_dir_url( __FILE__ ) );

require_once BELARIS_CHECKUP_DIR . 'includes/settings.php';
require_once BELARIS_CHECKUP_DIR . 'includes/leads.php';
require_once BELARIS_CHECKUP_DIR . 'includes/rest.php';
require_once BELARIS_CHECKUP_DIR . 'includes/shortcode.php';

register_activation_hook( __FILE__, 'belaris_checkup_activate' );
function belaris_checkup_activate() {
	if ( false === get_option( 'belaris_checkup_settings' ) ) {
		add_option( 'belaris_checkup_settings', belaris_checkup_defaults() );
	}
	belaris_checkup_register_lead_type();
}

add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), function ( $links ) {
	array_unshift( $links, '<a href="' . esc_url( admin_url( 'options-general.php?page=belaris-checkup' ) ) . '">' . esc_html__( 'Settings', 'belaris-checkup' ) . '</a>' );
	return $links;
} );
