import { LightningElement } from 'lwc';
import { RefreshEvent } from 'lightning/refresh';

export default class SfUiCNewBase extends LightningElement {
    color = '#1B96FF';
    range = 4;
    refreshCount = 0;

    handleColor(event) {
        this.color = event.detail.value;
    }

    handleRange(event) {
        this.range = event.detail.value;
    }

    sendRefresh() {
        // Asks the record page and its standard components to reload their data.
        this.dispatchEvent(new RefreshEvent());
        this.refreshCount += 1;
    }
}
