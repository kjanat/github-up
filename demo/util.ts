/** Checks if a value is a non-null object (i.e., a record)
 * and not an array.
 * @param value - The value to be checked.
 * @returns True if the value is a non-null object and not an array,
 * false otherwise.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Escapes special HTML characters in a string to prevent XSS
 * vulnerabilities when rendering user-generated content.
 * @example
 * ```js
 * escapeHtml('<script>alert("XSS")</script>');
 * // returns '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
 * escapeHtml('Hello & welcome!');
 * // returns 'Hello &amp; welcome!'
 * escapeHtml('5 > 3 and 2 < 4');
 * // returns '5 &gt; 3 and 2 &lt; 4'
 * escapeHtml('She said "Hello"');
 * // returns 'She said &quot;Hello&quot;'
 * escapeHtml("It's a nice day");
 * // returns 'It&#39;s a nice day'
 * ```
 * @param value - The input value to be escaped for HTML rendering.
 * @returns A string with special HTML characters escaped.
 */
function escapeHtml(value: unknown): string {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/**
 * Converts a string to a valid CSS token by removing all characters
 * except letters, digits, underscores, and hyphens.
 * @example
 * ```js
 * cssToken('Hello World!');
 * // returns 'HelloWorld'
 * cssToken('status:critical');
 * // returns 'statuscritical'
 * cssToken('component_status');
 * // returns 'component_status'
 * cssToken('123-invalid-token');
 * // returns '123invalidtoken'
 * cssToken('valid-token');
 * // returns 'valid-token'
 * ```
 * @param value - The input value to be converted to a CSS token.
 * @returns A string that is a valid CSS token.
 */
function cssToken(value: unknown): string {
	return String(value).replaceAll(/[^\w-]/gu, '');
}

/** Retrieves a string value from the given input, returning a
 * fallback if the input is not a string.
 * @param value - The input value to be checked and returned
 * if it's a string.
 * @param fallback - The value to return if the input is not a string.
 * Defaults to an empty string.
 * @returns The input value if it's a string, otherwise the
 * fallback value.
 */
function getString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

/** Retrieves an error message from an unknown error object,
 * returning the message if it's an Error instance, or a
 * string representation of the error otherwise.
 * @param error - The unknown error object to retrieve the message from.
 * @returns The error message if the error is an instance of Error,
 * otherwise a string representation of the error.
 */
function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Formats a date value (string, number, or Date) into a
 * human-readable string using the user's locale settings.
 * @param value - The date value to be formatted, which can be a string, number, or Date object.
 * @returns A formatted date string in the user's locale, with medium date style and short time style.
 */
function fmt(value: string | number | Date): string {
	return new Date(value).toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short',
	});
}

export { cssToken, escapeHtml, fmt, getErrorMessage, getString, isRecord };
