import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { openEnvironment } from './billing';
import { useNarration } from './NarrationContext';
import { useJudgeTheme } from './theme';
import { ANTHROPIC_KEY_NAME, NARRATION_COPY } from './verify/narration';

export default function NarrationHost() {
	const { theme } = useJudgeTheme();
	const { enableOpen, closeEnable, checkAgain, checkError, checking, toast, busy, progress, cancelNarrate } = useNarration();
	const [copied, setCopied] = useState(false);

	const copyName = async () => {
		try {
			await navigator.clipboard.writeText(ANTHROPIC_KEY_NAME);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			setCopied(false);
		}
	};

	return (
		<>
			{toast && createPortal(
				<div className="jh-toast" data-theme={theme} role="status">{toast}</div>,
				document.body,
			)}
			{busy && progress && createPortal(
				<div className="jh-toast jh-toast-progress" data-theme={theme} role="status">
					<span>{progress}</span>
					<button className="btn ghost sm" type="button" onClick={cancelNarrate}>Cancel</button>
				</div>,
				document.body,
			)}
			{enableOpen && createPortal(
				<div
					className="jh-checkout-bg"
					data-theme={theme}
					role="dialog"
					aria-modal="true"
					aria-labelledby="jh-narration-title"
					onClick={(e) => { if (e.target === e.currentTarget) closeEnable(); }}
				>
					<div className="jh jh-checkout" data-theme={theme} onClick={(e) => e.stopPropagation()}>
						<div className="section-kicker">AI narration</div>
						<h2 id="jh-narration-title">Enable AI narration</h2>
						<p className="muted" style={{ margin: '0 0 14px' }}>{NARRATION_COPY.dialogSentence}</p>
						<div className="jh-keychip">
							<code>{ANTHROPIC_KEY_NAME}</code>
							<button className="btn ghost sm" type="button" onClick={() => void copyName()}>
								{copied ? 'Copied' : NARRATION_COPY.copyName}
							</button>
						</div>
						<ol className="jh-narration-steps">
							<li>
								<button className="linkish" type="button" onClick={() => openEnvironment()}>
									{NARRATION_COPY.openEnv}
								</button>
								{' '}from Settings.
							</li>
							<li>{NARRATION_COPY.dialogStepAdd}</li>
							<li>{NARRATION_COPY.dialogStepBack}</li>
						</ol>
						{checkError && <p className="dqline" style={{ margin: '8px 0 0' }}>{checkError}</p>}
						<div className="jh-checkout-actions" style={{ marginTop: 16 }}>
							<button className="btn ghost sm" type="button" onClick={closeEnable}>Close</button>
							<button className="btn sm" type="button" disabled={checking} onClick={() => void checkAgain()}>
								{checking ? 'Checking…' : NARRATION_COPY.checkAgain}
							</button>
						</div>
					</div>
				</div>,
				document.body,
			)}
		</>
	);
}
