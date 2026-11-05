<?php
/**
 * Checkup markup. Variables: $privacy (string URL or '').
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<div class="bc" id="belaris-checkup">
	<div class="bc-scanbar" id="bc-scanbar" role="status" aria-live="polite" hidden>
		<span class="bc-spinner" aria-hidden="true"></span><span class="bc-scantext" id="bc-scan-text"></span>
	</div>

	<section id="bc-v-start" class="bc-panel" aria-labelledby="bc-start-title">
		<p class="bc-eyebrow">Free website checkup</p>
		<h2 id="bc-start-title" class="bc-h1" tabindex="-1">How well is your website working for your business?</h2>
		<p>We'll check your site the way a customer on a phone sees it: speed, security, accessibility, how easy you are to contact, and more. You'll get a score out of 100 and the three fixes that matter most.</p>
		<div class="bc-facts"><span><strong>About 2</strong> minutes</span><span><strong>4</strong> quick questions</span><span><strong>Free</strong> report</span></div>
		<form id="bc-start-form" class="bc-stack" novalidate>
			<div class="bc-field">
				<label for="bc-url">Your website address</label>
				<input type="text" id="bc-url" inputmode="url" autocomplete="url" placeholder="yourbusiness.com" required aria-describedby="bc-url-error" autocapitalize="off" spellcheck="false">
			</div>
			<div class="bc-row2">
				<div class="bc-field"><label for="bc-business">Business name</label><input type="text" id="bc-business" autocomplete="organization"></div>
				<div class="bc-field"><label for="bc-town">Town or city</label><input type="text" id="bc-town" autocomplete="address-level2"></div>
			</div>
			<p id="bc-url-error" class="bc-error" role="alert" hidden></p>
			<div class="bc-actions"><button class="bc-btn bc-btn-primary" type="submit" id="bc-start-btn">Check my website</button></div>
		</form>
	</section>

	<section id="bc-v-quiz" class="bc-panel" hidden>
		<div class="bc-progress">
			<div class="bc-progress-row"><span id="bc-q-count">Question 1 of 4</span><span class="bc-muted">While we scan your site</span></div>
			<div class="bc-bar" aria-hidden="true"><span id="bc-q-bar"></span></div>
		</div>
		<form id="bc-q-form" novalidate>
			<fieldset aria-describedby="bc-q-help bc-q-error">
				<legend><span id="bc-q-title" class="bc-h2" tabindex="-1"></span><span id="bc-q-help" class="bc-help"></span></legend>
				<div class="bc-options" id="bc-q-options"></div>
				<p id="bc-q-error" class="bc-error" role="alert" hidden>Choose an answer to continue. "Not sure" is fine.</p>
			</fieldset>
			<div class="bc-actions bc-split">
				<button class="bc-btn bc-btn-ghost" id="bc-q-back" type="button">Back</button>
				<button class="bc-btn bc-btn-primary" id="bc-q-next" type="submit">Next</button>
			</div>
		</form>
	</section>

	<section id="bc-v-gate" class="bc-panel" hidden aria-labelledby="bc-gate-title">
		<h2 id="bc-gate-title" class="bc-h2" tabindex="-1">Your results are almost ready</h2>
		<p class="bc-muted">Enter your email to see your score and your three next steps.<?php if ( belaris_checkup_get( 'visitor_email' ) ) : ?> We'll email you a copy to keep.<?php endif; ?></p>
		<form id="bc-gate-form" class="bc-stack" novalidate>
			<div class="bc-row2">
				<div class="bc-field"><label for="bc-name">First name</label><input type="text" id="bc-name" autocomplete="given-name"></div>
				<div class="bc-field"><label for="bc-email">Email</label><input type="email" id="bc-email" autocomplete="email" required aria-describedby="bc-gate-error"></div>
			</div>
			<div class="bc-hp" aria-hidden="true"><label for="bc-website-confirm">Leave this empty</label><input type="text" id="bc-website-confirm" tabindex="-1" autocomplete="off"></div>
			<label class="bc-check"><input type="checkbox" id="bc-consent"> <span>Belaris can follow up with tips and an offer to review my results. I can unsubscribe anytime.</span></label>
			<p id="bc-gate-error" class="bc-error" role="alert" hidden></p>
			<div class="bc-actions"><button class="bc-btn bc-btn-primary" type="submit" id="bc-gate-btn">See my score</button></div>
			<p class="bc-footnote">We only use your email to send your results and, if you tick the box, follow-up from Belaris. We never sell it.<?php if ( $privacy ) : ?> <a href="<?php echo esc_url( $privacy ); ?>">Privacy policy</a><?php endif; ?></p>
		</form>
	</section>

	<section id="bc-v-results" class="bc-stack" hidden aria-labelledby="bc-r-title">
		<div class="bc-panel">
			<p class="bc-eyebrow">Your website score</p>
			<div class="bc-score-head">
				<div class="bc-ring" role="img" id="bc-ring" aria-label="">
					<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false"><circle class="bc-track" cx="60" cy="60" r="52"></circle><circle class="bc-val" id="bc-ring-val" cx="60" cy="60" r="52" stroke-dasharray="326.73" stroke-dashoffset="326.73"></circle></svg>
					<div class="bc-num" aria-hidden="true"><b id="bc-score-num">0</b><span>out of 100</span></div>
				</div>
				<div class="bc-score-text">
					<h2 id="bc-r-title" class="bc-h1" tabindex="-1"></h2>
					<span><span class="bc-pill" id="bc-band"></span></span>
					<p id="bc-band-summary"></p>
					<p class="bc-site" id="bc-r-site"></p>
				</div>
			</div>
		</div>
		<div class="bc-panel">
			<div><h3 class="bc-h2">Your three next steps</h3><p class="bc-muted">Ordered by impact. Start with number one.</p></div>
			<ol class="bc-steps" id="bc-steps"></ol>
		</div>
		<div class="bc-panel" id="bc-a11y-panel">
			<div><h3 class="bc-h2">Accessibility check</h3><p class="bc-muted" id="bc-a11y-sub"></p></div>
			<ul class="bc-issues" id="bc-a11y-issues"></ul>
			<p class="bc-disclaimer">This is an automated check of your homepage. Automated tools catch only some accessibility problems, so a clean result here is not a guarantee of ADA or WCAG compliance.</p>
		</div>
		<div class="bc-panel">
			<h3 class="bc-h2">How you scored in each area</h3>
			<ul class="bc-breakdown" id="bc-breakdown"></ul>
		</div>
		<div class="bc-panel">
			<h3 class="bc-h2">Want help with these?</h3>
			<p>A Belaris specialist can walk through your results with you in a free 20-minute call.</p>
			<div class="bc-actions">
				<a class="bc-btn bc-btn-primary" id="bc-book" href="#" target="_blank" rel="noopener">Book a free review</a>
				<button class="bc-btn-link" id="bc-restart" type="button">Check another site</button>
			</div>
		</div>
	</section>
</div>
