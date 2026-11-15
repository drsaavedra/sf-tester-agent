import { LightningElement, wire } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';

export default class SfUiCUrl extends LightningElement {
    name = '(none)';

    @wire(CurrentPageReference)
    setRef(ref) {
        this.name = ref?.state?.c__name || '(none)';
    }
}
