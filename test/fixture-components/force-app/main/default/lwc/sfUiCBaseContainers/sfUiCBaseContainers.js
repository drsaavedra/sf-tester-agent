import { LightningElement } from 'lwc';

export default class SfUiCBaseContainers extends LightningElement {
    tileResult = 'none';
    tileActions = [
        { label: 'SFUIC Tile Edit', value: 'edit', iconName: 'utility:edit' },
        { label: 'SFUIC Tile Delete', value: 'delete', iconName: 'utility:delete' }
    ];

    tileAction(event) {
        this.tileResult = event.detail.action.value;
    }
}
