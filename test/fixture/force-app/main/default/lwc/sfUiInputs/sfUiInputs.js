import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import ACCOUNT_NAME from '@salesforce/schema/Account.Name';
import SfUiInputsModal from 'c/sfUiInputsModal';

// Fixture for the sf-ui combinations catalogue: three base inputs (combobox, datatable row action, record picker),
// each echoing its result as text, placed in a record page tab, a sidebar, a LightningModal and a screen flow.
export default class SfUiInputs extends LightningElement {
    @api recordId;
    size;
    rowAction;
    companyId;
    sizes = ['Small', 'Medium', 'Large'].map((s) => ({ label: s, value: s }));
    rows = [{ id: '1', name: 'row one' }, { id: '2', name: 'row two' }];
    columns = [
        { label: 'Name', fieldName: 'name' },
        { type: 'action', typeAttributes: { rowActions: [{ label: 'Edit', name: 'edit' }, { label: 'Archive', name: 'archive' }] } },
    ];

    @wire(getRecord, { recordId: '$companyId', fields: [ACCOUNT_NAME] }) company;

    get companyName() {
        return this.companyId && getFieldValue(this.company.data, ACCOUNT_NAME);
    }

    handleSize(event) {
        this.size = event.detail.value;
    }

    handleRowAction(event) {
        this.rowAction = `${event.detail.action.name} on ${event.detail.row.name}`;
    }

    handlePick(event) {
        this.companyId = event.detail.recordId;
    }

    handleOpen() {
        SfUiInputsModal.open({ size: 'medium', label: 'Inputs dialog' });
    }
}
