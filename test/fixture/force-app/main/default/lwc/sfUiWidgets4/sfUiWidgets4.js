import { LightningElement } from 'lwc';

// Fixture for the sf-ui combinations catalogue, batch 7: a datatable button column, a vertical tabset, an accordion
// that opens several sections, and checkable menu items, each echoing its result as text.
export default class SfUiWidgets4 extends LightningElement {
    orders = [{ id: 'o1', order: 'Order 100' }, { id: 'o2', order: 'Order 200' }];
    orderColumns = [
        { label: 'Order', fieldName: 'order', type: 'text' },
        { type: 'button', typeAttributes: { label: 'Approve', name: 'approve', variant: 'brand' } },
    ];
    approved;
    sideTwo = false;
    openSections;
    compact = false;
    wide = false;
    viewChosen;

    handleApprove(event) {
        this.approved = event.detail.row.order;
    }

    handleSide() {
        this.sideTwo = true;
    }

    handleSections(event) {
        const open = event.detail.openSections;
        this.openSections = [].concat(open || []).join(', ');
    }

    handleView(event) {
        this.compact = event.detail.value === 'compact';
        this.wide = event.detail.value === 'wide';
        this.viewChosen = event.detail.value;
    }
}
