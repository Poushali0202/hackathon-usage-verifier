import React from 'react';
import astronaut from './astronaut.svg';

/** Judge Hack mark — astronaut hopping the rocket. */
export function JudgeHackIcon({ size = 52 }: { size?: number }) {
	return (
		<img
			className="jh-brand-mark"
			src={astronaut}
			alt=""
			width={size}
			height={size}
			style={{ display: 'block', flexShrink: 0 }}
		/>
	);
}

/** Sidebar lockup: stacked mark + wordmark. Replaces the RocketRide header brand. */
export function JudgeHackLogo() {
	return (
		<div className="jh-brand" aria-label="Judge Hack">
			<JudgeHackIcon size={52} />
			<span className="jh-brand-wordmark">
				<span className="jh-brand-judge">Judge</span>
				{' '}
				<span className="jh-brand-hack">Hack</span>
			</span>
		</div>
	);
}
