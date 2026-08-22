export const PartyCapabilities = {
  partyCreate: "party.create",
  legalEntityCreate: "party.legal_entity.create",
  branchCreate: "party.branch.create",
  partyRoleAssign: "party.party_role.assign",
  partyRelationshipCreate: "party.party_relationship.create",
  partyRelationshipRead: "party.party_relationship.read",
  partyIdentifierAttach: "party.party_identifier.attach",
  partyRepresentationCreate: "party.party_representation.create",
  partyRepresentationActivate: "party.party_representation.activate",
  partyRepresentationDeactivate: "party.party_representation.deactivate",
} as const
