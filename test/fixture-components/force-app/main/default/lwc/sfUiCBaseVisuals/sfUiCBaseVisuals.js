import { LightningElement } from 'lwc';

export default class SfUiCBaseVisuals extends LightningElement {
    pills = ['SFUIC Pill One', 'SFUIC Pill Two'];
    removed = 'none';
    markers = [
        { location: { Street: '1 Market St', City: 'San Francisco', State: 'CA' }, title: 'SFUIC Map One' },
        { location: { Street: '415 Mission St', City: 'San Francisco', State: 'CA' }, title: 'SFUIC Map Two' }
    ];

    removePill(event) {
        this.removed = event.target.name;
        this.pills = this.pills.filter((p) => p !== this.removed);
    }
}
