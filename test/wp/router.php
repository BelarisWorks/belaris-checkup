<?php
/**
 * Router for `php -S` that serves a page containing [belaris_checkup] and the plugin's REST routes,
 * using the stand-ins in stubs.php. Usage: BC_STATE=/tmp/x.json php -S 127.0.0.1:9500 test/wp/router.php
 */
require __DIR__ . '/stubs.php';
$plugin = dirname( __DIR__, 2 ) . '/wordpress-plugin/belaris-checkup';
require $plugin . '/belaris-checkup.php';
do_action( 'init' );
do_action( 'rest_api_init' );
do_action( 'wp_enqueue_scripts' );

$path = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );

if ( 0 === strpos( $path, '/plugin/assets/' ) ) {
	$file = $plugin . '/assets/' . basename( $path );
	if ( ! is_file( $file ) ) { http_response_code( 404 ); exit; }
	header( 'Content-Type: ' . ( substr( $file, -3 ) === '.js' ? 'text/javascript' : 'text/css' ) );
	readfile( $file );
	exit;
}

if ( 0 === strpos( $path, '/wp-json/' ) ) {
	$route = substr( $path, strlen( '/wp-json' ) );
	foreach ( $GLOBALS['bc_routes'] as $r ) {
		list( $pattern, $args ) = $r;
		$re = '#^' . preg_replace( '#\(\?P<(\w+)>#', '(?P<$1>', $pattern ) . '$#';
		if ( preg_match( $re, $route, $m ) && $_SERVER['REQUEST_METHOD'] === $args['methods'] ) {
			$params = array_filter( $m, 'is_string', ARRAY_FILTER_USE_KEY );
			$body   = json_decode( file_get_contents( 'php://input' ), true );
			$res    = call_user_func( $args['callback'], new WP_REST_Request( array_merge( (array) $body, $params ) ) );
			http_response_code( $res->status );
			header( 'Content-Type: application/json' );
			echo json_encode( $res->data );
			exit;
		}
	}
	http_response_code( 404 ); echo '{"code":"rest_no_route"}'; exit;
}

// A page that looks roughly like a WordPress theme page, with the shortcode in the content.
$content = call_user_func( $GLOBALS['bc_shortcodes']['belaris_checkup'] );
?><!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Website Checkup – Belaris</title>
<link rel="stylesheet" href="<?php echo esc_attr( $GLOBALS['bc_assets']['belaris-checkup-css'] ); ?>">
<style>/* aggressive "theme" styles, to prove the plugin's styles hold up */
body{margin:0;font-family:Georgia,serif;background:#fafafa;color:#222} .site-header{background:#111;color:#fff;padding:16px} main{padding:24px 16px}
button,input[type=submit]{background:#e91e63;color:#fff;text-transform:uppercase;border-radius:0;padding:4px 8px;letter-spacing:2px}
input{border:1px solid #f00;padding:2px} h2{color:#c00;font-size:40px} ul{list-style:square} label{display:block;font-size:12px}</style>
</head><body><header class="site-header">BELARIS (theme header)</header><main><h1>Free Website Checkup</h1>
<?php echo $content; // phpcs:ignore ?>
</main>
<script><?php echo implode( "\n", $GLOBALS['bc_inline'] ); // phpcs:ignore ?></script>
<script src="<?php echo esc_attr( $GLOBALS['bc_assets']['belaris-checkup-js'] ); ?>"></script>
</body></html>
