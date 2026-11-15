// Slice 10 sample data: one SFUIC Case for the Case record page (safe to run twice).
if ([SELECT COUNT() FROM Case WHERE Subject = 'SFUIC Case'] == 0) {
    insert new Case(Subject = 'SFUIC Case');
    System.debug('made: SFUIC Case');
} else {
    System.debug('exists: SFUIC Case');
}
