import LightningDatatable from 'lightning/datatable';
import badgeTemplate from './sfUiCBadgeType.html';

// A datatable with one custom data type, sfuicBadge, drawn as a lightning-badge.
export default class SfUiCTableTypes extends LightningDatatable {
    static customTypes = {
        sfuicBadge: { template: badgeTemplate, standardCellLayout: true }
    };
}
