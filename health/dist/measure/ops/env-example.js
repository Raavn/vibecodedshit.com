/** `KEY=value`, `export KEY=value`, blank lines, `#` comment lines and quoted values. A commented-out `# KEY=` line does not count. */
export function parseEnvExample(text) {
    const out = {};
    for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.trim();
        if (line === '' || line.startsWith('#'))
            continue;
        const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(line);
        if (!match?.[1])
            continue;
        let value = (match[2] ?? '').trim();
        const quote = value[0];
        if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0)
            value = value.slice(1, value.lastIndexOf(quote));
        else
            value = value.replace(/\s+#.*$/, '');
        out[match[1]] = value;
    }
    return out;
}
