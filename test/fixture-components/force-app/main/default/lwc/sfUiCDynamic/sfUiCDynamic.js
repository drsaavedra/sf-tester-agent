import { LightningElement } from 'lwc';

export default class SfUiCDynamic extends LightningElement {
    ctor;
    status = 'not loaded';

    async load() {
        const { default: ctor } = await import('c/sfUiCSlot');
        this.ctor = ctor;
        this.status = 'loaded c/sfUiCSlot';
    }
}
