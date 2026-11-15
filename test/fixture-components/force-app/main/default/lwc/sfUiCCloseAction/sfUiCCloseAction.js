import { LightningElement, api } from 'lwc';
import { CloseActionScreenEvent } from 'lightning/actions';

export default class SfUiCCloseAction extends LightningElement {
    @api recordId;

    close() {
        this.dispatchEvent(new CloseActionScreenEvent());
    }
}
