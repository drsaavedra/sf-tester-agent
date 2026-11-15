import { LightningElement, api } from 'lwc';
import { CloseActionScreenEvent } from 'lightning/actions';

// Fixture for the sf-ui combinations catalogue: both input components inside an LWC screen quick action, a record
// action modal that is not a LightningModal.
export default class SfUiInputsAction extends LightningElement {
    @api recordId;

    handleClose() {
        this.dispatchEvent(new CloseActionScreenEvent());
    }
}
