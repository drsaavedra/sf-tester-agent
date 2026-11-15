import { LightningElement } from 'lwc';
import saveItem from '@salesforce/apex/S4Map_Controller.saveItem';

// Fixture for the static map: saves an item through Apex. Never placed on a page.
export default class S4MapPanel extends LightningElement {
    save() {
        return saveItem({ name: 'x', qty: 1 });
    }
}
