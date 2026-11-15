import { LightningElement } from 'lwc';
import { openDistributedMarketing } from 'lightning/distributedMarketing';

export default class SfUiCGated extends LightningElement {
    items = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), name: `SFUIC Row ${i + 1}` }));
    marketingResult = 'not opened';

    async openMarketing() {
        // The org has no Distributed Marketing, so the error text is the expected result.
        try {
            await openDistributedMarketing({});
            this.marketingResult = 'opened';
        } catch (e) {
            this.marketingResult = 'error: ' + (e && e.message ? e.message : String(e));
        }
    }
}
