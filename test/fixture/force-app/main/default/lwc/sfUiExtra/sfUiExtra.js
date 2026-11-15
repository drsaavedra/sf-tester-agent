import { LightningElement } from 'lwc';

// Fixture for the sf-ui combinations catalogue, batch 2: textarea, button menu, accordion and datatable inline edit,
// each echoing its result as text; rendered inside sfUiMore, so it sits in every container sfUiMore does.
export default class SfUiExtra extends LightningElement {
    remarks;
    menu;
    section;
    saved;
    drafts = [];
    items = [{ id: '1', name: 'item one', qty: 1 }, { id: '2', name: 'item two', qty: 2 }];
    itemColumns = [
        { label: 'Item', fieldName: 'name' },
        { label: 'Qty', fieldName: 'qty', type: 'number', editable: true },
    ];

    handleRemarks(event) {
        this.remarks = event.target.value;
    }

    handleMenu(event) {
        this.menu = event.detail.value;
    }

    handleSection(event) {
        this.section = [].concat(event.detail.openSections).join(', ');
    }

    handleSave(event) {
        const byId = Object.fromEntries(this.items.map((i) => [i.id, i]));
        this.saved = event.detail.draftValues.map((d) => `${d.qty} on ${byId[d.id].name}`).join(', ');
        this.drafts = [];
    }
}
