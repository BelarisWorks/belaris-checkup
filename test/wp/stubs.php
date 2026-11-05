<?php
/**
 * Minimal stand-ins for the WordPress functions the plugin uses, so its PHP can run for real
 * outside WordPress. State (options, transients, posts, emails) persists in a JSON file
 * between requests. This is a test harness, not a WordPress replacement.
 */
define( 'ABSPATH', __DIR__ . '/' );
define( 'HOUR_IN_SECONDS', 3600 );
$GLOBALS['bc_state_file'] = getenv( 'BC_STATE' ) ?: sys_get_temp_dir() . '/bc-state.json';

function bc_state( $set = null ) {
	static $s = null;
	if ( null === $s ) {
		$s = file_exists( $GLOBALS['bc_state_file'] ) ? json_decode( file_get_contents( $GLOBALS['bc_state_file'] ), true ) : array();
		$s += array( 'options' => array(), 'transients' => array(), 'posts' => array(), 'meta' => array(), 'mail' => array(), 'next_id' => 1 );
	}
	if ( null !== $set ) {
		$s = $set;
		file_put_contents( $GLOBALS['bc_state_file'], json_encode( $s, JSON_PRETTY_PRINT ) );
	}
	return $s;
}
function bc_put( $key, $sub, $val ) { $s = bc_state(); $s[ $key ][ $sub ] = $val; bc_state( $s ); }

$GLOBALS['bc_hooks'] = array(); $GLOBALS['bc_routes'] = array(); $GLOBALS['bc_shortcodes'] = array();
$GLOBALS['bc_assets'] = array(); $GLOBALS['bc_inline'] = array();
function add_action( $h, $cb, $p = 10, $n = 1 ) { $GLOBALS['bc_hooks'][ $h ][] = $cb; }
function add_filter( $h, $cb, $p = 10, $n = 1 ) { $GLOBALS['bc_hooks'][ $h ][] = $cb; }
function do_action( $h ) { foreach ( isset( $GLOBALS['bc_hooks'][ $h ] ) ? $GLOBALS['bc_hooks'][ $h ] : array() as $cb ) { call_user_func( $cb ); } }
function register_activation_hook( $f, $cb ) {}
function add_shortcode( $tag, $cb ) { $GLOBALS['bc_shortcodes'][ $tag ] = $cb; }
function register_rest_route( $ns, $route, $args ) { $GLOBALS['bc_routes'][] = array( '/' . $ns . $route, $args ); }
function register_post_type( $t, $a ) {}
function register_setting() {}
function plugin_dir_path( $f ) { return dirname( $f ) . '/'; }
function plugin_dir_url( $f ) { return '/plugin/'; }
function plugin_basename( $f ) { return basename( dirname( $f ) ) . '/' . basename( $f ); }
function get_option( $k, $d = false ) { $s = bc_state(); return array_key_exists( $k, $s['options'] ) ? $s['options'][ $k ] : $d; }
function add_option( $k, $v ) { bc_put( 'options', $k, $v ); }
function update_option( $k, $v ) { bc_put( 'options', $k, $v ); }
function wp_parse_args( $a, $d ) { return array_merge( $d, (array) $a ); }
function sanitize_text_field( $s ) { return trim( preg_replace( '/[\r\n\t ]+/', ' ', strip_tags( (string) $s ) ) ); }
function sanitize_email( $e ) { $e = trim( (string) $e ); return filter_var( $e, FILTER_VALIDATE_EMAIL ) ? $e : ''; }
function is_email( $e ) { return (bool) filter_var( $e, FILTER_VALIDATE_EMAIL ); }
function esc_url_raw( $u, $p = null ) { $u = trim( (string) $u ); return preg_match( '#^(https?:)?//#i', $u ) || '' === $u || '/' === $u[0] ? $u : ''; }
function esc_url( $u ) { return htmlspecialchars( esc_url_raw( $u ), ENT_QUOTES ); }
function esc_html( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_attr( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_html__( $s, $d = '' ) { return esc_html( $s ); }
function esc_attr__( $s, $d = '' ) { return esc_attr( $s ); }
function wp_unslash( $s ) { return $s; }
function untrailingslashit( $s ) { return rtrim( $s, '/\\' ); }
function wp_json_encode( $d ) { return json_encode( $d ); }
function wp_parse_url( $u, $c = -1 ) { return parse_url( $u, $c ); }
function home_url( $p = '' ) { return 'http://belaris.test' . $p; }
function admin_url( $p = '' ) { return 'http://belaris.test/wp-admin/' . $p; }
function rest_url( $p = '' ) { return '/wp-json/' . $p; }
function get_privacy_policy_url() { return ''; }
function set_transient( $k, $v, $t ) { bc_put( 'transients', $k, $v ); }
function get_transient( $k ) { $s = bc_state(); return isset( $s['transients'][ $k ] ) ? $s['transients'][ $k ] : false; }
function wp_insert_post( $p, $err = false ) {
	$s = bc_state(); $id = $s['next_id']++; $p['ID'] = $id; $p['date'] = gmdate( 'c' ); $s['posts'][ $id ] = $p; bc_state( $s ); return $id;
}
function update_post_meta( $id, $k, $v ) { $s = bc_state(); $s['meta'][ $id ][ $k ] = $v; bc_state( $s ); }
function get_post_meta( $id, $k, $single = false ) { $s = bc_state(); return isset( $s['meta'][ $id ][ $k ] ) ? $s['meta'][ $id ][ $k ] : ''; }
function get_post_time( $f, $gmt, $id ) { $s = bc_state(); return $s['posts'][ $id ]['date']; }
function wp_mail( $to, $subject, $body, $headers = array() ) { $s = bc_state(); $s['mail'][] = compact( 'to', 'subject', 'body', 'headers' ); bc_state( $s ); return true; }
function wp_register_style( $h, $src ) { $GLOBALS['bc_assets'][ $h . '-css' ] = $src; }
function wp_register_script( $h, $src ) { $GLOBALS['bc_assets'][ $h . '-js' ] = $src; }
function wp_enqueue_style( $h ) {}
function wp_enqueue_script( $h ) {}
function wp_add_inline_script( $h, $code, $pos ) { $GLOBALS['bc_inline'][] = $code; }

class WP_Error { public $m; function __construct( $c, $m ) { $this->m = $m; } function get_error_message() { return $this->m; } }
function is_wp_error( $x ) { return $x instanceof WP_Error; }
function wp_remote_request( $url, $args ) {
	$ch = curl_init( $url );
	$h  = array();
	foreach ( (array) $args['headers'] as $k => $v ) { $h[] = $k . ': ' . $v; }
	curl_setopt_array( $ch, array( CURLOPT_CUSTOMREQUEST => $args['method'], CURLOPT_HTTPHEADER => $h, CURLOPT_RETURNTRANSFER => true,
		CURLOPT_TIMEOUT => $args['timeout'], CURLOPT_NOPROXY => '*' ) );
	if ( isset( $args['body'] ) ) { curl_setopt( $ch, CURLOPT_POSTFIELDS, $args['body'] ); }
	$body = curl_exec( $ch );
	if ( false === $body ) { return new WP_Error( 'http', curl_error( $ch ) ); }
	return array( 'code' => curl_getinfo( $ch, CURLINFO_RESPONSE_CODE ), 'body' => $body );
}
function wp_remote_get( $url, $a = array() ) { return wp_remote_request( $url, $a + array( 'method' => 'GET', 'headers' => array(), 'timeout' => 10 ) ); }
function wp_remote_post( $url, $a = array() ) { return wp_remote_request( $url, $a + array( 'method' => 'POST', 'timeout' => 10 ) ); }
function wp_remote_retrieve_response_code( $r ) { return $r['code']; }
function wp_remote_retrieve_body( $r ) { return $r['body']; }

class WP_REST_Request implements ArrayAccess {
	private $p;
	function __construct( $params ) { $this->p = $params; }
	function get_param( $k ) { return isset( $this->p[ $k ] ) ? $this->p[ $k ] : null; }
	function offsetExists( $k ): bool { return isset( $this->p[ $k ] ); }
	function offsetGet( $k ): mixed { return $this->p[ $k ]; }
	function offsetSet( $k, $v ): void { $this->p[ $k ] = $v; }
	function offsetUnset( $k ): void { unset( $this->p[ $k ] ); }
}
class WP_REST_Response {
	public $data; public $status;
	function __construct( $d, $s = 200 ) { $this->data = $d; $this->status = $s; }
}
