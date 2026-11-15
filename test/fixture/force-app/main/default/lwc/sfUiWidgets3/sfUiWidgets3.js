import { LightningElement } from 'lwc';

// Fixture for the sf-ui combinations catalogue, batch 6: datatable row selection, a password, a location, a
// button-style radio group and a checkbox button, each echoing its result as text.
export default class SfUiWidgets3 extends LightningElement {
    crew = [{ id: 'c1', member: 'Ana' }, { id: 'c2', member: 'Ben' }, { id: 'c3', member: 'Cy' }];
    crewColumns = [{ label: 'Member', fieldName: 'member', type: 'text' }];
    picked;
    passLength;
    site;
    speeds = [{ label: 'Slow', value: 'slow' }, { label: 'Fast', value: 'fast' }];
    speed;
    express = false;

    handleRows(event) {
        this.picked = event.detail.selectedRows.map((r) => r.member).join(', ');
    }

    handlePass(event) {
        this.passLength = (event.detail.value || '').length;
    }

    handleSite(event) {
        const { latitude, longitude } = event.target;
        this.site = latitude && longitude ? `${latitude}, ${longitude}` : undefined;
    }

    handleSpeed(event) {
        this.speed = event.detail.value;
    }

    handleExpress(event) {
        this.express = event.detail.checked;
    }
}
