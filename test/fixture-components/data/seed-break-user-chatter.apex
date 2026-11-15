// Run after seed-slice-11.apex and seed-break-user-group.apex (safe to run twice). Makes Probe Breaker a
// member of the Chatter group SFUIC Group, so he is offered its Announcement action (A4-018).
List<User> breakers = [SELECT Id FROM User WHERE FirstName = 'Probe' AND LastName = 'Breaker' AND IsActive = true];
CollaborationGroup cg = [SELECT Id FROM CollaborationGroup WHERE Name = 'SFUIC Group'];
Set<Id> have = new Set<Id>();
for (CollaborationGroupMember m : [SELECT MemberId FROM CollaborationGroupMember WHERE CollaborationGroupId = :cg.Id]) {
    have.add(m.MemberId);
}
List<CollaborationGroupMember> adds = new List<CollaborationGroupMember>();
for (User u : breakers) {
    if (!have.contains(u.Id)) {
        adds.add(new CollaborationGroupMember(CollaborationGroupId = cg.Id, MemberId = u.Id));
    }
}
insert adds;
System.debug('Probe Breaker users: ' + breakers.size() + ', added to SFUIC Group: ' + adds.size());
