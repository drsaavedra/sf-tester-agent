import { LightningElement } from 'lwc';

// Fixture for the sf-ui combinations catalogue, batch 5: a tree grid, a sortable datatable, address and name inputs,
// breadcrumbs, and color, tel and url inputs, each echoing its result as text.
export default class SfUiWidgets2 extends LightningElement {
    teams = [{ name: 'Ops', lead: 'Ana', _children: [{ name: 'Ops North', lead: 'Ben' }, { name: 'Ops South', lead: 'Cy' }] }];
    teamColumns = [{ label: 'Team', fieldName: 'name', type: 'text' }, { label: 'Lead', fieldName: 'lead', type: 'text' }];
    toggled;
    items = [{ id: '1', item: 'Bolt', qty: 5 }, { id: '2', item: 'Nut', qty: 9 }, { id: '3', item: 'Washer', qty: 2 }];
    sortColumns = [{ label: 'Part', fieldName: 'item', type: 'text', sortable: true }, { label: 'Stock', fieldName: 'qty', type: 'number', sortable: true }];
    sortedBy;
    sortedDirection;
    city;
    fullName;
    salutations = [{ label: 'Ms.', value: 'Ms.' }, { label: 'Mr.', value: 'Mr.' }];
    crumb;
    colour;
    tel;
    url;

    get sortedItems() {
        if (!this.sortedBy) return this.items;
        const k = this.sortedBy;
        const sign = this.sortedDirection === 'desc' ? -1 : 1;
        return [...this.items].sort((a, b) => (a[k] > b[k] ? sign : a[k] < b[k] ? -sign : 0));
    }

    get firstItem() {
        return this.sortedItems[0].item;
    }

    handleToggle(event) {
        this.toggled = `${event.detail.name} ${event.detail.isExpanded ? 'open' : 'closed'}`;
    }

    handleSort(event) {
        this.sortedBy = event.detail.fieldName;
        this.sortedDirection = event.detail.sortDirection;
    }

    handleAddress(event) {
        this.city = event.detail.city;
    }

    handleName(event) {
        this.fullName = [event.detail.salutation, event.detail.firstName, event.detail.lastName].filter(Boolean).join(' ');
    }

    handleCrumb(event) {
        event.preventDefault();
        this.crumb = event.target.name;
    }

    handleColour(event) {
        this.colour = event.detail.value;
    }

    handleTel(event) {
        this.tel = event.detail.value;
    }

    handleUrl(event) {
        this.url = event.target.checkValidity() ? event.detail.value : undefined;
    }
}
