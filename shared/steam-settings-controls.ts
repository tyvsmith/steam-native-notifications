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

let cached: ReturnType<typeof discoverControls> | undefined;
export function steamSettingsControls(): ReturnType<typeof discoverControls> {
    if (cached) return cached;
    const chunks = (globalThis as any).webpackChunksteamui;
    if (!Array.isArray(chunks)) throw new Error('Steam loader unavailable');
    let requireModule: any;
    chunks.push([[`snn-controls-${crypto.randomUUID()}`], {}, (value: any) => { requireModule = value; }]);
    return cached = discoverControls(requireModule);
}
