// =============================================================================
// MIT License
// =============================================================================

/** RocketRide pipeline files — JSON with a .pipe extension (see the .pipe
 * rule in rsbuild.config.mts). Import one and pass it to
 * client.use({ pipeline }) — browser bundles cannot use filepath loading. */
declare module '*.pipe' {
	const value: Record<string, unknown>;
	export default value;
}

declare module '*.svg' {
	const value: string;
	export default value;
}
