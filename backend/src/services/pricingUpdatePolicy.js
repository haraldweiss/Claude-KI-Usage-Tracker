export function decideUpdateAction(current, upstream) {
    if (current.source === 'manual')
        return 'skip';
    if (current.status === 'pending_confirmation')
        return 'skip';
    if (!upstream) {
        if (current.source === 'auto' && current.status !== 'deprecated')
            return 'mark_deprecated';
        return 'skip';
    }
    const priceChanged = current.input_price !== upstream.input || current.output_price !== upstream.output;
    if (current.source === 'tier_default')
        return 'graduate';
    if (current.source === 'auto' && priceChanged)
        return 'overwrite';
    return 'skip';
}
//# sourceMappingURL=pricingUpdatePolicy.js.map