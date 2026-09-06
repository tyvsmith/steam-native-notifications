/** Preserve Steam's rendered localized copy while splitting its heading. */
export function splitToastText(text: string): { title: string; body: string } {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);

	if (lines.length === 0) return { title: 'Steam', body: '' };
	if (lines.length === 1) return { title: 'Steam', body: lines[0] };
	return { title: lines[0], body: lines.slice(1).join(' — ') };
}
