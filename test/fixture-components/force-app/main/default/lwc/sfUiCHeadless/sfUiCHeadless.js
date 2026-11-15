import { LightningElement, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export default class SfUiCHeadless extends LightningElement {
    @api recordId;

    @api invoke() {
        this.dispatchEvent(new ShowToastEvent({ title: 'SFUIC Headless', message: 'SFUIC headless action ran', variant: 'success' }));
    }
}
