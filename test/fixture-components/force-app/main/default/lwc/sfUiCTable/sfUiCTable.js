import { LightningElement } from 'lwc';

const NOTE = 'SFUIC long note that wraps onto a second line when wrap text is on for this column';
const makeRows = (from, count) =>
    Array.from({ length: count }, (_, i) => ({
        id: 'r' + (from + i),
        name: 'SFUIC Row ' + (from + i),
        stage: ['Open', 'Working', 'Closed'][(from + i) % 3],
        note: NOTE
    }));

export default class SfUiCTable extends LightningElement {
    rows = makeRows(1, 5);
    infiniteRows = makeRows(1, 20);
    moreToLoad = true;
    headerResult = 'none';
    resizeResult = 'not resized';
    selectedName = 'none';

    basicColumns = [
        { label: 'Name', fieldName: 'name' },
        { label: 'Stage', fieldName: 'stage' }
    ];
    headerColumns = [
        { label: 'Name', fieldName: 'name' },
        {
            label: 'Note',
            fieldName: 'note',
            wrapText: true,
            actions: [
                { label: 'SFUIC Sort A-Z', name: 'sort_asc' },
                { label: 'SFUIC Reset', name: 'reset' }
            ]
        }
    ];
    resizeColumns = [
        { label: 'Name', fieldName: 'name', initialWidth: 160 },
        { label: 'Stage', fieldName: 'stage', initialWidth: 120 }
    ];
    customColumns = [
        { label: 'Name', fieldName: 'name' },
        { label: 'Stage', fieldName: 'stage', type: 'sfuicBadge' }
    ];

    get infiniteCount() {
        return this.infiniteRows.length;
    }

    loadMore() {
        const next = makeRows(this.infiniteRows.length + 1, 20);
        this.infiniteRows = [...this.infiniteRows, ...next];
        if (this.infiniteRows.length >= 60) this.moreToLoad = false;
    }

    headerAction(event) {
        this.headerResult = event.detail.action.label + ' on ' + event.detail.columnDefinition.label;
    }

    resized(event) {
        this.resizeResult = event.detail.columnWidths.join(', ');
    }

    selected(event) {
        const sel = event.detail.selectedRows;
        this.selectedName = sel.length ? sel[0].name : 'none';
    }
}
