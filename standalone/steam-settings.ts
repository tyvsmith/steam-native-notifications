/** Private Steam seam, observed in desktop build 1791592380. Refuse ambiguity on updates. */
export const PAGE_ID = 'snn-native-notifications';
type Registry = { readonly size: number };
export function isSettingsRegistry(value: any): value is Registry {
    return Object.prototype.toString.call(value) === '[object Set]' && Number.isSafeInteger(value?.size) && value.size >= 0
        && typeof value.values === 'function' && typeof value.has === 'function';
}
type Page = { identifier: string; [key: string]: unknown };
export function isDesktopSettings(props: any): boolean {
    return typeof props?.page === 'string' && props.page.startsWith('/settings/') && Array.isArray(props.pages)
        && ['/settings/account', '/settings/notifications', '/settings/interface'].every(id => props.pages.some((p: any) => p?.identifier === id));
}
export function insertPage(pages: any[], page: Page): any[] {
    if (pages.some(p => p?.identifier === page.identifier)) return pages;
    return [...pages, 'separator', page];
}
export function discoverSettings(requireModule: any): { React: typeof import('react'); widget: any; instances: Registry } {
    if (typeof requireModule !== 'function') throw new Error('Steam module loader unavailable');
    const factories = Object.entries(requireModule.m ?? {});
    const reactFactories = factories.filter(([, f]) => String(f).includes('react.production.js') && String(f).includes('react.forward_ref'));
    const pageFactories = factories.filter(([, f]) => String(f).includes('m_setPagedSettingsInstances') && String(f).includes('renderPageContent') && String(f).includes('PageListColumn'));
    if (reactFactories.length !== 1 || pageFactories.length !== 1) throw new Error('Steam settings interface unavailable or ambiguous');
    const React = requireModule(reactFactories[0]![0]);
    const exports = Object.values(requireModule(pageFactories[0]![0]));
    const registries = exports.filter((v: any) => typeof v?.Get === 'function' && String(v).includes('m_setPagedSettingsInstances'));
    if (registries.length !== 1) throw new Error('Steam settings registry unavailable');
    const instances = (registries[0] as any).Get()?.m_setPagedSettingsInstances;
    if (!isSettingsRegistry(instances)) throw new Error('Steam settings registry incompatible');
    const widgets = exports.filter((v: any) => v?.$$typeof === Symbol.for('react.forward_ref') && typeof v.render === 'function' && String(v.render).includes('renderPageContent'));
    if (typeof React?.createElement !== 'function' || typeof React?.useState !== 'function' || widgets.length !== 1 || !Object.getOwnPropertyDescriptor(widgets[0], 'render')?.writable) throw new Error('Steam settings interface incompatible');
    return { React, widget: widgets[0], instances };
}
/** Keep Steam's hooks in their own component and intercept only our page selection. */
export function mountSettings(React: typeof import('react'), widget: any, Panel: any, report: (state: string) => void, instances: Registry = new Set(), dividerClass?: string): () => void {
    if (instances.size) throw new Error('Close Steam dialogs before attaching settings');
    const h = React.createElement;
    const original = widget.render;
    const Original = React.forwardRef(original);
    function Settings(props: any) {
        const { forwardedRef, ...steam } = props;
        const [selectedAt, select] = React.useState<string | null>(null);
        React.useEffect(() => select(null), [steam.page]);
        const selected = selectedAt === steam.page;
        const pages = insertPage(steam.pages, { identifier: PAGE_ID, title: 'Native Notifications', visible: true, icon: steam.pages.find((p: any) => p?.identifier === '/settings/notifications')?.icon, content: h(Panel) });
        // Steam hides dividers beside the selection. Keep our extension boundary visible.
        const separator = steam.PageListSeparatorComponent;
        return h(Original, { ...steam, ref: forwardedRef, pages, page: selected ? PAGE_ID : steam.page,
            PageListSeparatorComponent: selected && (separator || dividerClass) ? (props: any) => separator
                ? h(separator, { ...props, bTransparent: false }) : h('div', { role: 'separator', className: dividerClass }) : separator,
            onPageRequested: (id: string) => { select(id === PAGE_ID ? steam.page : null); if (id !== PAGE_ID) steam.onPageRequested?.(id); } });
    }
    class Boundary extends React.Component<any, { failed: boolean }> {
        state = { failed: false };
        static getDerivedStateFromError() { return { failed: true }; }
        componentDidCatch() { report('unavailable'); }
        render() { return this.state.failed ? h(Original, { ...this.props.steam, ref: this.props.forwardedRef }) : this.props.children; }
    }
    const patched = (props: any, ref: any) => isDesktopSettings(props)
        ? h(Boundary, { steam: props, forwardedRef: ref }, h(Settings, { ...props, forwardedRef: ref }))
        : h(Original, { ...props, ref });
    widget.render = patched;
    report('installed');
    return () => {
        const restore = () => {
            if (instances.size) return false;
            if (widget.render === patched) widget.render = original;
            report('stopped'); return true;
        };
        if (!restore()) { const timer = setInterval(() => { if (restore()) clearInterval(timer); }, 500); }
    };
}

/** Resolve the same themed controls used by Steam desktop settings, without export IDs. */
export function discoverControls(requireModule: any): Record<'DividerClass' | 'Theme' | 'Toggle' | 'Section' | 'Button' | 'Buttons' | 'Description', any> {
    const modules = Object.entries(requireModule.m ?? {}).filter(([, factory]) => {
        const source = String(factory);
        return source.includes('PagedSettings:') && source.includes('ToggleField:') && source.includes('BottomButtons');
    });
    if (modules.length !== 1) throw new Error('Steam settings controls unavailable or ambiguous');
    const values = Object.values(requireModule(modules[0]![0]));
    const find = (...signatures: string[]) => {
        const matches = values.filter((value: any) => signatures.every(s => String(value?.render ?? value).includes(s)));
        if (matches.length !== 1) throw new Error('Steam settings control incompatible');
        return matches[0];
    };
    const styles = Object.entries(requireModule.m ?? {}).filter(([, f]) => ['PageListSeparator:', 'Transparent:', 'PagedSettingsDialog_PageListColumn:'].every(s => String(f).includes(s)));
    if (styles.length !== 1) throw new Error('Steam sidebar styles unavailable or ambiguous');
    const dividerClass = requireModule(styles[0]![0]).PageListSeparator;
    if (typeof dividerClass !== 'string') throw new Error('Steam sidebar divider unavailable');
    return {
        DividerClass: dividerClass,
        Theme: find('PagedSettings:', 'ToggleField:', 'strButtonClassName:'),
        Toggle: find('"ToggleField"'), Section: find('"DialogSettingsSection"'),
        Button: find('"DialogButton"', '"Secondary"'), Buttons: find('.BottomButtons'),
        Description: find('.FieldDescription'),
    };
}
