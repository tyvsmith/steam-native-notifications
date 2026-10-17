/** Private Steam seam, observed in desktop build 1792110651. Refuse ambiguity on updates. */
const NOTIFICATIONS_PAGE = '/settings/notifications';
type Registry = { readonly size: number };
export function isSettingsRegistry(value: any): value is Registry {
    return Object.prototype.toString.call(value) === '[object Set]' && Number.isSafeInteger(value?.size) && value.size >= 0
        && typeof value.values === 'function' && typeof value.has === 'function';
}
export function isDesktopSettings(props: any): boolean {
    return typeof props?.page === 'string' && props.page.startsWith('/settings/') && Array.isArray(props.pages)
        && ['/settings/account', '/settings/notifications', '/settings/interface'].every(id => props.pages.some((p: any) => p?.identifier === id));
}
/** Change only the unique Notifications descriptor; refuse changed Steam shapes. */
export function appendSection(React: typeof import('react'), pages: any[], wrap: (element: React.ReactElement) => React.ReactElement): any[] {
    const matches = pages.filter(page => page?.identifier === NOTIFICATIONS_PAGE);
    if (matches.length !== 1 || !React.isValidElement(matches[0].content)) return pages;
    const page = matches[0];
    const content = wrap(page.content);
    if (content === page.content) return pages;
    return pages.map(value => value === page ? { ...page, content } : value);
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
/** Keep Steam's content and navigation intact; isolate failures to the appended section. */
export function mountSettings(React: typeof import('react'), widget: any, Body: any, Panel: any, report: (state: string) => void, instances: Registry = new Set()): () => void {
    if (instances.size) throw new Error('Close Steam dialogs before attaching settings');
    const h = React.createElement;
    const original = widget.render;
    const Original = React.forwardRef(original);
    class Boundary extends React.Component<any, { failed: boolean }> {
        state = { failed: false };
        static getDerivedStateFromError() { return { failed: true }; }
        componentDidCatch() { report('unavailable'); }
        render() { return this.state.failed ? null : this.props.children; }
    }
    const wrappers = new Map<any, any>();
    const ownWrappers = new Set<any>();
    const wrap = (element: React.ReactElement): React.ReactElement => {
        if (ownWrappers.has(element.type)) return element;
        const Native = element.type as any;
        if (typeof Native !== 'function' || Native.prototype?.isReactComponent || /^class\s/.test(String(Native)) || Native.constructor?.name !== 'Function') {
            report('unavailable'); return element;
        }
        let Content = wrappers.get(Native);
        if (!Content) {
            // Native hooks run unconditionally in a stable component dedicated to this type.
            // Keep the observed DialogBody and its children so the extension shares its scroll.
            Content = function NotificationsContent(props: any) {
                const body = Native(props);
                if (!React.isValidElement(body) || body.type !== Body) { report('unavailable'); return body; }
                return React.cloneElement(body, {}, (body.props as any).children, h(Boundary, {}, h(Panel)));
            };
            wrappers.set(Native, Content); ownWrappers.add(Content);
        }
        return h(Content, { ...element.props as object, key: element.key, ref: (element as any).ref });
    };
    const patched = (props: any, ref: any) => {
        if (!isDesktopSettings(props)) return h(Original, { ...props, ref });
        const pages = appendSection(React, props.pages, wrap);
        if (pages === props.pages && !pages.some(page => ownWrappers.has(page?.content?.type))) report('unavailable');
        return h(Original, { ...props, ref, pages });
    };
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
export function discoverControls(requireModule: any): Record<'Body' | 'Theme' | 'Toggle' | 'Section' | 'Button' | 'Description' | 'ConfirmDialog' | 'ShowModal' | 'ActionSection', any> {
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
    const bodyModules = Object.entries(requireModule.m ?? {}).filter(([, factory]) => {
        const source = String(factory);
        return source.includes('SettingsDialogBodyFade') && source.includes('disableFade');
    });
    if (bodyModules.length !== 1) throw new Error('Steam settings body unavailable or ambiguous');
    const bodies = Object.values(requireModule(bodyModules[0]![0])).filter((value: any) =>
        typeof value === 'function' && String(value).includes('SettingsDialogBodyFade') && String(value).includes('disableFade'));
    if (bodies.length !== 1) throw new Error('Steam settings body incompatible');
    const component = (...signatures: string[]) => {
        const candidates = Object.entries(requireModule.m ?? {}).filter(([, factory]) => signatures.every(s => String(factory).includes(s)));
        const matches = candidates.flatMap(([id]) => Object.values(requireModule(id))).filter(value =>
            typeof value === 'function' && signatures.every(s => String(value).includes(s)));
        if (matches.length !== 1) throw new Error('Steam confirmation dialog unavailable or ambiguous');
        return matches[0];
    };
    const libraryStyles = Object.entries(requireModule.m ?? {}).filter(([, factory]) =>
        String(factory).includes('LibrarySettings:') && String(factory).includes('ActionSection:'));
    if (libraryStyles.length !== 1) throw new Error('Steam Library action styles unavailable or ambiguous');
    const actionSection = requireModule(libraryStyles[0]![0]).ActionSection;
    if (typeof actionSection !== 'string' || !actionSection) throw new Error('Steam Library action styles incompatible');
    return {
        Body: bodies[0], Theme: find('PagedSettings:', 'ToggleField:', 'strButtonClassName:'),
        Toggle: find('"ToggleField"'), Section: find('"DialogSettingsSection"'),
        Button: component('().SettingsDialogButton,', '.$n,'),
        ActionSection: actionSection,
        Description: find('.FieldDescription'),
        ConfirmDialog: component('strOKButtonText:', 'strCancelButtonText:', 'bAlertDialog:', 'focusButton:'),
        ShowModal: component('ShowLegacyPopupModal', 'cloneElement', 'ShowModal('),
    };
}
