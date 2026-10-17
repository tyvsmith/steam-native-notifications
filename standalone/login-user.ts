/** Read only loginusers.vdf's users/account/field shape. Refuse ambiguous identity. */
export function loginUser(text: string): string | undefined {
    const tokens: string[] = [];
    const token = /\s+|\/\/[^\r\n]*|"((?:\\.|[^"\\])*)"|[{}]/gy;
    let offset = 0;
    while (offset < text.length) {
        token.lastIndex = offset;
        const match = token.exec(text);
        if (!match) return undefined;
        offset = token.lastIndex;
        if (match[1] !== undefined) tokens.push('"' + match[1].replace(/\\(.)/g, '$1'));
        else if (match[0] === '{' || match[0] === '}') tokens.push(match[0]);
    }
    let i = 0;
    const string = () => tokens[i]?.startsWith('"') ? tokens[i++]!.slice(1) : undefined;
    if (string()?.toLowerCase() !== 'users' || tokens[i++] !== '{') return undefined;
    const accounts: string[] = [], recent: string[] = [];
    while (tokens[i] !== '}') {
        const id = string();
        if (!id || !/^7656119\d{10}$/.test(id) || accounts.includes(id) || tokens[i++] !== '{') return undefined;
        accounts.push(id);
        const fields = new Set<string>();
        while (tokens[i] !== '}') {
            const key = string()?.toLowerCase(), value = string();
            if (key === undefined || value === undefined || fields.has(key)) return undefined;
            fields.add(key);
            if (key === 'mostrecent' && value === '1') recent.push(id);
        }
        i++;
    }
    if (++i !== tokens.length) return undefined;
    return recent.length === 1 ? recent[0] : recent.length === 0 && accounts.length === 1 ? accounts[0] : undefined;
}
