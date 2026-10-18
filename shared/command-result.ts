/** Execution acknowledgement never implies capture or visible desktop delivery. */
export function sampleMessage(result: any): string {
    if (result?.result?.ok === false || result?.ok === false)
        return 'Sample could not run. ' + (result.result?.message || result.error || result.message || 'Try again when Steam is connected.');
    const value = result?.ok === true ? result.value : result;
    if (value?.stage === 'executed') return 'Steam completed the sample request. Notification capture, delivery and banner visibility have not been confirmed.';
    if (value?.stage === 'unconfirmed') return 'Sample execution is unconfirmed. Notification capture, delivery and banner visibility have not been confirmed.';
    if (value?.stage === 'queued') return 'Sample request queued. Steam has not confirmed execution or notification delivery.';
    return 'Sample request accepted. Execution and notification delivery have not been confirmed.';
}
