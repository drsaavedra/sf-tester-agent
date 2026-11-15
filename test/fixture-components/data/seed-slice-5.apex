// Slice 5 sample data: one Next Best Action recommendation, created only when it is missing (safe to run twice).
// Needs the flow SfUiC_Nba_Action deployed and active; SfUiC_Nba_Strategy returns every SFUIC recommendation.
if ([SELECT COUNT() FROM Recommendation WHERE Name = 'SFUIC Recommendation'] == 0) {
    insert new Recommendation(
        Name = 'SFUIC Recommendation',
        Description = 'SFUIC recommendation for the break run',
        AcceptanceLabel = 'SFUIC Accept',
        RejectionLabel = 'SFUIC Reject',
        ActionReference = 'SfUiC_Nba_Action'
    );
    System.debug('made: SFUIC Recommendation');
} else {
    System.debug('nothing (already seeded)');
}
