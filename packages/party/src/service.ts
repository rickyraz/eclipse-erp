import { and, eq } from "drizzle-orm"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

import {
  branches,
  partyRepresentations,
  legalEntities,
  parties,
  partyIdentifiers,
  partyRelationships,
  partyRoles,
} from "../../../db/schema/party.ts"
import { Principal } from "../../auth/mod.ts"
import { AuthorizationDenied, AuthorizationService } from "../../authorization/mod.ts"
import { PartyCapabilities } from "./capabilities.ts"
import { Database, DatabaseFailure, isDatabaseConstraint } from "../../kernel/mod.ts"

const NonEmptyString = Schema.String.check(Schema.isNonEmpty())
const NonBlankString = Schema.String.check(Schema.isPattern(/\S/))

export const PartyKind = Schema.Literals(["person", "organization"])
export const PartyRole = Schema.Literals(["customer", "supplier", "employee", "partner"])
export const PartyRelationshipKind = Schema.Literals([
  "customer",
  "supplier",
  "employee",
  "partner",
])

export const Party = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  kind: PartyKind,
  name: Schema.String,
})

export const ExternalIdentifier = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  partyId: Schema.String,
  provider: Schema.String,
  scheme: Schema.String,
  scope: Schema.String,
  legalEntityId: Schema.NullOr(Schema.String),
  value: Schema.String,
})

export const LegalEntity = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  organizationId: Schema.String,
})

export const Branch = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  legalEntityId: Schema.String,
  name: Schema.String,
  timezone: Schema.NullOr(Schema.String),
  localTaxRegistration: Schema.NullOr(Schema.String),
  dedicatedJournalCode: Schema.NullOr(Schema.String),
})

export const PartyRepresentationKind = NonBlankString

export const PartyRepresentation = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  userAccountId: Schema.String,
  partyId: Schema.String,
  kind: PartyRepresentationKind,
  active: Schema.Boolean,
})

export const PartyRelationship = Schema.Struct({
  id: Schema.String,
  tenantId: Schema.String,
  partyId: Schema.String,
  legalEntityId: Schema.String,
  kind: PartyRelationshipKind,
  active: Schema.Boolean,
})

export type Party = Schema.Schema.Type<typeof Party>

export type ExternalIdentifier = Schema.Schema.Type<typeof ExternalIdentifier>
export type LegalEntity = Schema.Schema.Type<typeof LegalEntity>
export type Branch = Schema.Schema.Type<typeof Branch>
export type PartyRepresentation = Schema.Schema.Type<typeof PartyRepresentation>
export type PartyRelationship = Schema.Schema.Type<typeof PartyRelationship>
export type PartyRepresentationKind = Schema.Schema.Type<typeof PartyRepresentationKind>
export type PartyRole = Schema.Schema.Type<typeof PartyRole>
export type PartyRelationshipKind = Schema.Schema.Type<typeof PartyRelationshipKind>

const ScopedInput = { principal: Principal, tenantId: Schema.String }

export const CreatePartyInput = Schema.Struct({
  ...ScopedInput,
  kind: PartyKind,
  name: NonEmptyString,
})

export const AssignPartyRoleInput = Schema.Struct({
  ...ScopedInput,
  partyId: Schema.String,
  role: PartyRole,
})

export const CreatePartyRelationshipInput = Schema.Struct({
  ...ScopedInput,
  partyId: Schema.String,
  legalEntityId: Schema.String,
  kind: PartyRelationshipKind,
})

export const AttachExternalIdentifierInput = Schema.Struct({
  ...ScopedInput,
  partyId: Schema.String,
  provider: NonEmptyString,
  scheme: NonEmptyString,
  scope: NonEmptyString,
  legalEntityId: Schema.optionalKey(Schema.String),
  value: NonEmptyString,
})

export const CreateLegalEntityInput = Schema.Struct({
  ...ScopedInput,
  organizationId: Schema.String,
})

export const CreateBranchInput = Schema.Struct({
  ...ScopedInput,
  legalEntityId: Schema.String,
  name: NonEmptyString,
  timezone: Schema.optionalKey(NonEmptyString),
  localTaxRegistration: Schema.optionalKey(NonBlankString),
  dedicatedJournalCode: Schema.optionalKey(NonBlankString),
})

export const CreatePartyRepresentationInput = Schema.Struct({
  ...ScopedInput,
  userAccountId: Schema.String,
  partyId: Schema.String,
  kind: PartyRepresentationKind,
})

export const SetPartyRepresentationActiveInput = Schema.Struct({
  ...ScopedInput,
  representationId: Schema.String,
  active: Schema.Boolean,
})

export class PartyNotFound extends Schema.TaggedErrorClass<PartyNotFound>()("PartyNotFound", {
  tenantId: Schema.String,
  partyId: Schema.String,
}) {}

export class PartyRoleAlreadyAssigned
  extends Schema.TaggedErrorClass<PartyRoleAlreadyAssigned>()("PartyRoleAlreadyAssigned", {
    tenantId: Schema.String,
    partyId: Schema.String,
    role: PartyRole,
  }) {}

export class PartyRelationshipAlreadyExists
  extends Schema.TaggedErrorClass<PartyRelationshipAlreadyExists>()(
    "PartyRelationshipAlreadyExists",
    {
      tenantId: Schema.String,
      partyId: Schema.String,
      legalEntityId: Schema.String,
      kind: PartyRelationshipKind,
    },
  ) {}

export class PartyRelationshipRoleNotAssigned
  extends Schema.TaggedErrorClass<PartyRelationshipRoleNotAssigned>()(
    "PartyRelationshipRoleNotAssigned",
    {
      tenantId: Schema.String,
      partyId: Schema.String,
      kind: PartyRelationshipKind,
    },
  ) {}

export class ExternalIdentifierAlreadyAssigned
  extends Schema.TaggedErrorClass<ExternalIdentifierAlreadyAssigned>()(
    "ExternalIdentifierAlreadyAssigned",
    {
      tenantId: Schema.String,
      provider: Schema.String,
      scheme: Schema.String,
      scope: Schema.String,
      legalEntityId: Schema.NullOr(Schema.String),
      value: Schema.String,
    },
  ) {}

export class OrganizationRequired
  extends Schema.TaggedErrorClass<OrganizationRequired>()("OrganizationRequired", {
    tenantId: Schema.String,
    partyId: Schema.String,
  }) {}

export class LegalEntityAlreadyExists
  extends Schema.TaggedErrorClass<LegalEntityAlreadyExists>()("LegalEntityAlreadyExists", {
    tenantId: Schema.String,
    organizationId: Schema.String,
  }) {}

export class LegalEntityNotFound
  extends Schema.TaggedErrorClass<LegalEntityNotFound>()("LegalEntityNotFound", {
    tenantId: Schema.String,
    legalEntityId: Schema.String,
  }) {}

export class BranchAlreadyExists
  extends Schema.TaggedErrorClass<BranchAlreadyExists>()("BranchAlreadyExists", {
    tenantId: Schema.String,
    legalEntityId: Schema.String,
    name: Schema.String,
  }) {}

export class PartyRepresentationUserAccountNotFound
  extends Schema.TaggedErrorClass<PartyRepresentationUserAccountNotFound>()(
    "PartyRepresentationUserAccountNotFound",
    {
      tenantId: Schema.String,
      userAccountId: Schema.String,
    },
  ) {}

export class PartyRepresentationAlreadyExists
  extends Schema.TaggedErrorClass<PartyRepresentationAlreadyExists>()(
    "PartyRepresentationAlreadyExists",
    {
      tenantId: Schema.String,
      userAccountId: Schema.String,
      partyId: Schema.String,
      kind: PartyRepresentationKind,
    },
  ) {}

export class PartyRepresentationNotFound
  extends Schema.TaggedErrorClass<PartyRepresentationNotFound>()(
    "PartyRepresentationNotFound",
    {
      tenantId: Schema.String,
      representationId: Schema.String,
    },
  ) {}

type CommonFailure = AuthorizationDenied | DatabaseFailure | Schema.SchemaError

export interface PartyService {
  readonly create: (input: unknown) => Effect.Effect<Party, CommonFailure>
  readonly createLegalEntity: (
    input: unknown,
  ) => Effect.Effect<
    LegalEntity,
    | PartyNotFound
    | OrganizationRequired
    | LegalEntityAlreadyExists
    | CommonFailure
  >
  readonly createBranch: (
    input: unknown,
  ) => Effect.Effect<Branch, LegalEntityNotFound | BranchAlreadyExists | CommonFailure>
  readonly createPartyRepresentation: (
    input: unknown,
  ) => Effect.Effect<
    PartyRepresentation,
    | PartyRepresentationUserAccountNotFound
    | PartyRepresentationAlreadyExists
    | PartyNotFound
    | CommonFailure
  >
  readonly setPartyRepresentationActive: (
    input: unknown,
  ) => Effect.Effect<
    PartyRepresentation,
    PartyRepresentationNotFound | CommonFailure
  >
  readonly assignRole: (
    input: unknown,
  ) => Effect.Effect<void, PartyNotFound | PartyRoleAlreadyAssigned | CommonFailure>
  readonly createRelationship: (
    input: unknown,
  ) => Effect.Effect<
    PartyRelationship,
    | LegalEntityNotFound
    | PartyNotFound
    | PartyRelationshipAlreadyExists
    | PartyRelationshipRoleNotAssigned
    | CommonFailure
  >
  readonly attachIdentifier: (
    input: unknown,
  ) => Effect.Effect<
    ExternalIdentifier,
    | LegalEntityNotFound
    | PartyNotFound
    | ExternalIdentifierAlreadyAssigned
    | CommonFailure
  >
}

export const PartyService = Context.Service<PartyService>("EclipseERP/PartyService")

const partySelection = {
  id: parties.id,
  tenantId: parties.tenantId,
  kind: parties.kind,
  name: parties.name,
}

const identifierSelection = {
  id: partyIdentifiers.id,
  tenantId: partyIdentifiers.tenantId,
  partyId: partyIdentifiers.partyId,
  provider: partyIdentifiers.provider,
  scheme: partyIdentifiers.scheme,
  scope: partyIdentifiers.scope,
  legalEntityId: partyIdentifiers.legalEntityId,
  value: partyIdentifiers.value,
}

const legalEntitySelection = {
  id: legalEntities.id,
  tenantId: legalEntities.tenantId,
  organizationId: legalEntities.organizationPartyId,
}

const branchSelection = {
  id: branches.id,
  tenantId: branches.tenantId,
  legalEntityId: branches.legalEntityId,
  name: branches.name,
  timezone: branches.timezone,
  localTaxRegistration: branches.localTaxRegistration,
  dedicatedJournalCode: branches.dedicatedJournalCode,
}

const partyRepresentationSelection = {
  id: partyRepresentations.id,
  tenantId: partyRepresentations.tenantId,
  userAccountId: partyRepresentations.userAccountId,
  partyId: partyRepresentations.partyId,
  kind: partyRepresentations.kind,
  active: partyRepresentations.active,
}

const relationshipSelection = {
  id: partyRelationships.id,
  tenantId: partyRelationships.tenantId,
  partyId: partyRelationships.partyId,
  legalEntityId: partyRelationships.legalEntityId,
  kind: partyRelationships.kind,
  active: partyRelationships.active,
}

export const makePartyService = Effect.gen(function* () {
  const database = yield* Database
  const authorization = yield* AuthorizationService
  return {
  create: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreatePartyInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: PartyCapabilities.partyCreate,
      })
      const rows = yield* database.query(
        (db) =>
          db.insert(parties)
            .values({ tenantId: decoded.tenantId, kind: decoded.kind, name: decoded.name.trim() })
            .returning(partySelection),
        "party.create",
      )
      return rows[0]!
    }),
  createLegalEntity: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateLegalEntityInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: PartyCapabilities.legalEntityCreate,
      })
      const partyRows = yield* database.query(
        (db) =>
          db.select({ id: parties.id, kind: parties.kind })
            .from(parties)
            .where(
              and(
                eq(parties.tenantId, decoded.tenantId),
                eq(parties.id, decoded.organizationId),
              ),
            ),
        "party.legal_entity.party.get",
      )
      const party = partyRows[0]
      if (party === undefined) {
        return yield* Effect.fail(
          new PartyNotFound({ tenantId: decoded.tenantId, partyId: decoded.organizationId }),
        )
      }
      if (party.kind !== "organization") {
        return yield* Effect.fail(
          new OrganizationRequired({
            tenantId: decoded.tenantId,
            partyId: decoded.organizationId,
          }),
        )
      }
      const rows = yield* database.query(
        (db) =>
          db.insert(legalEntities)
            .values({
              tenantId: decoded.tenantId,
              organizationPartyId: decoded.organizationId,
            })
            .returning(legalEntitySelection),
        "party.legal_entity.create",
      ).pipe(
        Effect.mapError((error) =>
          isDatabaseConstraint(error, "legal_entities_tenant_organization_party_key")
            ? new LegalEntityAlreadyExists({
              tenantId: decoded.tenantId,
              organizationId: decoded.organizationId,
            })
            : error
        ),
      )
      return rows[0]!
    }),
  createBranch: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreateBranchInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: PartyCapabilities.branchCreate,
      })
      const legalEntityRows = yield* database.query(
        (db) =>
          db.select({ id: legalEntities.id })
            .from(legalEntities)
            .where(
              and(
                eq(legalEntities.tenantId, decoded.tenantId),
                eq(legalEntities.id, decoded.legalEntityId),
              ),
            ),
        "party.branch.legal_entity.get",
      )
      if (legalEntityRows[0] === undefined) {
        return yield* Effect.fail(
          new LegalEntityNotFound({
            tenantId: decoded.tenantId,
            legalEntityId: decoded.legalEntityId,
          }),
        )
      }
      const name = decoded.name.trim()
      const timezone = decoded.timezone?.trim() ?? null
      const localTaxRegistration = decoded.localTaxRegistration?.trim() ?? null
      const dedicatedJournalCode = decoded.dedicatedJournalCode?.trim() ?? null
      const rows = yield* database.query(
        (db) =>
          db.insert(branches)
            .values({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              name,
              timezone,
              localTaxRegistration,
              dedicatedJournalCode,
            })
            .returning(branchSelection),
        "party.branch.create",
      ).pipe(
        Effect.mapError((error) =>
          isDatabaseConstraint(error, "branches_tenant_legal_entity_name_key")
            ? new BranchAlreadyExists({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              name,
            })
            : error
        ),
      )
      return rows[0]!
    }),
  createPartyRepresentation: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreatePartyRepresentationInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: PartyCapabilities.partyRepresentationCreate,
      })
      const kind = decoded.kind.trim()
      const rows = yield* database.query(
        (db) =>
          db.insert(partyRepresentations)
            .values({
              tenantId: decoded.tenantId,
              userAccountId: decoded.userAccountId,
              partyId: decoded.partyId,
              kind,
              active: true,
            })
            .returning(partyRepresentationSelection),
        "party.representation.create",
      ).pipe(
        Effect.mapError((error) => {
          if (isDatabaseConstraint(error, "party_representations_user_account_fkey", "23503")) {
            return new PartyRepresentationUserAccountNotFound({
              tenantId: decoded.tenantId,
              userAccountId: decoded.userAccountId,
            })
          }
          if (isDatabaseConstraint(error, "party_representations_party_fkey", "23503")) {
            return new PartyNotFound({
              tenantId: decoded.tenantId,
              partyId: decoded.partyId,
            })
          }
          if (
            isDatabaseConstraint(
              error,
              "party_representations_tenant_user_account_party_kind_key",
            )
          ) {
            return new PartyRepresentationAlreadyExists({
              tenantId: decoded.tenantId,
              userAccountId: decoded.userAccountId,
              partyId: decoded.partyId,
              kind,
            })
          }
          return error
        }),
      )
      return rows[0]!
    }),
  setPartyRepresentationActive: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(SetPartyRepresentationActiveInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: decoded.active
          ? PartyCapabilities.partyRepresentationActivate
          : PartyCapabilities.partyRepresentationDeactivate,
      })
      const rows = yield* database.query(
        (db) =>
          db.update(partyRepresentations)
            .set({ active: decoded.active })
            .where(
              and(
                eq(partyRepresentations.tenantId, decoded.tenantId),
                eq(partyRepresentations.id, decoded.representationId),
              ),
            )
            .returning(partyRepresentationSelection),
        "party.representation.set-active",
      )
      const representation = rows[0]
      if (representation === undefined) {
        return yield* Effect.fail(
          new PartyRepresentationNotFound({
            tenantId: decoded.tenantId,
            representationId: decoded.representationId,
          }),
        )
      }
      return representation
    }),
  assignRole: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(AssignPartyRoleInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: PartyCapabilities.partyRoleAssign,
      })
      yield* database.query(
        (db) =>
          db.insert(partyRoles).values({
            tenantId: decoded.tenantId,
            partyId: decoded.partyId,
            role: decoded.role,
          }),
        "party.role.assign",
      ).pipe(
        Effect.mapError((error) => {
          if (isDatabaseConstraint(error, "party_roles_tenant_party_fkey", "23503")) {
            return new PartyNotFound({
              tenantId: decoded.tenantId,
              partyId: decoded.partyId,
            })
          }
          if (isDatabaseConstraint(error, "party_roles_pkey")) {
            return new PartyRoleAlreadyAssigned({
              tenantId: decoded.tenantId,
              partyId: decoded.partyId,
              role: decoded.role,
            })
          }
          return error
        }),
      )
    }),
  createRelationship: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(CreatePartyRelationshipInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: PartyCapabilities.partyRelationshipCreate,
      })
      const rows = yield* database.query(
        (db) =>
          db.insert(partyRelationships).values({
            tenantId: decoded.tenantId,
            partyId: decoded.partyId,
            legalEntityId: decoded.legalEntityId,
            kind: decoded.kind,
            active: true,
          }).returning(relationshipSelection),
        "party.relationship.create",
      ).pipe(
        Effect.mapError((error) => {
          if (isDatabaseConstraint(error, "party_relationships_tenant_party_fkey", "23503")) {
            return new PartyNotFound({
              tenantId: decoded.tenantId,
              partyId: decoded.partyId,
            })
          }
          if (
            isDatabaseConstraint(
              error,
              "party_relationships_tenant_legal_entity_fkey",
              "23503",
            )
          ) {
            return new LegalEntityNotFound({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
            })
          }
          if (isDatabaseConstraint(error, "party_relationships_tenant_party_role_fkey", "23503")) {
            return new PartyRelationshipRoleNotAssigned({
              tenantId: decoded.tenantId,
              partyId: decoded.partyId,
              kind: decoded.kind,
            })
          }
          if (
            isDatabaseConstraint(
              error,
              "party_relationships_tenant_party_legal_entity_kind_key",
            )
          ) {
            return new PartyRelationshipAlreadyExists({
              tenantId: decoded.tenantId,
              partyId: decoded.partyId,
              legalEntityId: decoded.legalEntityId,
              kind: decoded.kind,
            })
          }
          return error
        }),
      )
      return rows[0]!
    }),
  attachIdentifier: (input) =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(AttachExternalIdentifierInput)(input)
      yield* authorization.authorize({
        principal: decoded.principal,
        tenantId: decoded.tenantId,
        capability: PartyCapabilities.partyIdentifierAttach,
      })
      const provider = decoded.provider.trim().toUpperCase()
      const scheme = decoded.scheme.trim().toUpperCase()
      const scope = decoded.scope.trim()
      const legalEntityId = decoded.legalEntityId ?? null
      const value = decoded.value.trim()
      const rows = yield* database.query(
        (db) =>
          db.insert(partyIdentifiers)
            .values({
              tenantId: decoded.tenantId,
              partyId: decoded.partyId,
              provider,
              scheme,
              scope,
              legalEntityId,
              value,
            })
            .returning(identifierSelection),
        "party.identifier.attach",
      ).pipe(
        Effect.mapError((error) => {
          if (isDatabaseConstraint(error, "party_identifiers_tenant_party_fkey", "23503")) {
            return new PartyNotFound({
              tenantId: decoded.tenantId,
              partyId: decoded.partyId,
            })
          }
          if (
            legalEntityId !== null &&
            isDatabaseConstraint(
              error,
              "party_identifiers_tenant_legal_entity_fkey",
              "23503",
            )
          ) {
            return new LegalEntityNotFound({
              tenantId: decoded.tenantId,
              legalEntityId,
            })
          }
          if (
            isDatabaseConstraint(
              error,
              "party_identifiers_tenant_provider_scope_value_uq",
            ) ||
            isDatabaseConstraint(
              error,
              "party_identifiers_tenant_provider_entity_scope_value_uq",
            )
          ) {
            return new ExternalIdentifierAlreadyAssigned({
              tenantId: decoded.tenantId,
              provider,
              scheme,
              scope,
              legalEntityId,
              value,
            })
          }
          return error
        }),
      )
      return rows[0]!
    }),
  } satisfies PartyService
})

export const makePartyTestLayer = (validUserAccountIds?: ReadonlySet<string>) =>
  Layer.effect(
    PartyService,
    Effect.gen(function* () {
      const authorization = yield* AuthorizationService
      const stored = new Map<string, Party>()
      const storedLegalEntities = new Map<string, LegalEntity>()
      const storedBranches = new Map<string, Branch>()
      const roles = new Set<string>()
      const relationships = new Map<string, PartyRelationship>()
      const identifiers = new Set<string>()
      const representations = new Map<string, PartyRepresentation>()
      let sequence = 1
      const nextId = () => `party-test-${sequence++}`

      const service: PartyService = {
    create: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreatePartyInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: PartyCapabilities.partyCreate,
        })
        const party = {
          id: nextId(),
          tenantId: decoded.tenantId,
          kind: decoded.kind,
          name: decoded.name.trim(),
        }
        stored.set(party.id, party)
        return party
      }),
    createLegalEntity: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateLegalEntityInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: PartyCapabilities.legalEntityCreate,
        })
        const party = stored.get(decoded.organizationId)
        if (party === undefined || party.tenantId !== decoded.tenantId) {
          return yield* Effect.fail(
            new PartyNotFound({
              tenantId: decoded.tenantId,
              partyId: decoded.organizationId,
            }),
          )
        }
        if (party.kind !== "organization") {
          return yield* Effect.fail(
            new OrganizationRequired({
              tenantId: decoded.tenantId,
              partyId: decoded.organizationId,
            }),
          )
        }
        if (
          [...storedLegalEntities.values()].some((legalEntity) =>
            legalEntity.tenantId === decoded.tenantId &&
            legalEntity.organizationId === decoded.organizationId
          )
        ) {
          return yield* Effect.fail(
            new LegalEntityAlreadyExists({
              tenantId: decoded.tenantId,
              organizationId: decoded.organizationId,
            }),
          )
        }
        const legalEntity = {
          id: nextId(),
          tenantId: decoded.tenantId,
          organizationId: decoded.organizationId,
        }
        storedLegalEntities.set(legalEntity.id, legalEntity)
        return legalEntity
      }),
    createBranch: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreateBranchInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: PartyCapabilities.branchCreate,
        })
        const legalEntity = storedLegalEntities.get(decoded.legalEntityId)
        if (legalEntity === undefined || legalEntity.tenantId !== decoded.tenantId) {
          return yield* Effect.fail(
            new LegalEntityNotFound({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
            }),
          )
        }
        const name = decoded.name.trim()
        if (
          [...storedBranches.values()].some((branch) =>
            branch.tenantId === decoded.tenantId &&
            branch.legalEntityId === decoded.legalEntityId &&
            branch.name === name
          )
        ) {
          return yield* Effect.fail(
            new BranchAlreadyExists({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
              name,
            }),
          )
        }
        const branch = {
          id: nextId(),
          tenantId: decoded.tenantId,
          legalEntityId: decoded.legalEntityId,
          name,
          timezone: decoded.timezone?.trim() ?? null,
          localTaxRegistration: decoded.localTaxRegistration?.trim() ?? null,
          dedicatedJournalCode: decoded.dedicatedJournalCode?.trim() ?? null,
        }
        storedBranches.set(branch.id, branch)
        return branch
      }),
    createPartyRepresentation: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreatePartyRepresentationInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: PartyCapabilities.partyRepresentationCreate,
        })
        if (
          validUserAccountIds !== undefined &&
          !validUserAccountIds.has(decoded.userAccountId)
        ) {
          return yield* Effect.fail(
            new PartyRepresentationUserAccountNotFound({
              tenantId: decoded.tenantId,
              userAccountId: decoded.userAccountId,
            }),
          )
        }
        if (stored.get(decoded.partyId)?.tenantId !== decoded.tenantId) {
          return yield* Effect.fail(
            new PartyNotFound({ tenantId: decoded.tenantId, partyId: decoded.partyId }),
          )
        }
        const kind = decoded.kind.trim()
        if ([...representations.values()].some((representation) =>
          representation.tenantId === decoded.tenantId &&
          representation.userAccountId === decoded.userAccountId &&
          representation.partyId === decoded.partyId &&
          representation.kind === kind
        )) {
          return yield* Effect.fail(
            new PartyRepresentationAlreadyExists({
              tenantId: decoded.tenantId,
              userAccountId: decoded.userAccountId,
              partyId: decoded.partyId,
              kind,
            }),
          )
        }
        const representation = {
          id: nextId(),
          tenantId: decoded.tenantId,
          userAccountId: decoded.userAccountId,
          partyId: decoded.partyId,
          kind,
          active: true,
        }
        representations.set(representation.id, representation)
        return representation
      }),
    setPartyRepresentationActive: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(SetPartyRepresentationActiveInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: decoded.active
            ? PartyCapabilities.partyRepresentationActivate
            : PartyCapabilities.partyRepresentationDeactivate,
        })
        const representation = representations.get(decoded.representationId)
        if (representation === undefined || representation.tenantId !== decoded.tenantId) {
          return yield* Effect.fail(
            new PartyRepresentationNotFound({
              tenantId: decoded.tenantId,
              representationId: decoded.representationId,
            }),
          )
        }
        const updated = { ...representation, active: decoded.active }
        representations.set(updated.id, updated)
        return updated
      }),
    assignRole: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(AssignPartyRoleInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: PartyCapabilities.partyRoleAssign,
        })
        if (stored.get(decoded.partyId)?.tenantId !== decoded.tenantId) {
          return yield* Effect.fail(
            new PartyNotFound({ tenantId: decoded.tenantId, partyId: decoded.partyId }),
          )
        }
        const key = `${decoded.tenantId}:${decoded.partyId}:${decoded.role}`
        if (roles.has(key)) return yield* Effect.fail(new PartyRoleAlreadyAssigned(decoded))
        roles.add(key)
      }),
    createRelationship: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(CreatePartyRelationshipInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: PartyCapabilities.partyRelationshipCreate,
        })
        const party = stored.get(decoded.partyId)
        if (party === undefined || party.tenantId !== decoded.tenantId) {
          return yield* Effect.fail(
            new PartyNotFound({ tenantId: decoded.tenantId, partyId: decoded.partyId }),
          )
        }
        const legalEntity = storedLegalEntities.get(decoded.legalEntityId)
        if (legalEntity === undefined || legalEntity.tenantId !== decoded.tenantId) {
          return yield* Effect.fail(
            new LegalEntityNotFound({
              tenantId: decoded.tenantId,
              legalEntityId: decoded.legalEntityId,
            }),
          )
        }
        const roleKey = `${decoded.tenantId}:${decoded.partyId}:${decoded.kind}`
        if (!roles.has(roleKey)) {
          return yield* Effect.fail(
            new PartyRelationshipRoleNotAssigned({
              tenantId: decoded.tenantId,
              partyId: decoded.partyId,
              kind: decoded.kind,
            }),
          )
        }
        const key =
          `${decoded.tenantId}:${decoded.partyId}:${decoded.legalEntityId}:${decoded.kind}`
        if (relationships.has(key)) {
          return yield* Effect.fail(
            new PartyRelationshipAlreadyExists({
              tenantId: decoded.tenantId,
              partyId: decoded.partyId,
              legalEntityId: decoded.legalEntityId,
              kind: decoded.kind,
            }),
          )
        }
        const relationship: PartyRelationship = {
          id: nextId(),
          tenantId: decoded.tenantId,
          partyId: decoded.partyId,
          legalEntityId: decoded.legalEntityId,
          kind: decoded.kind,
          active: true,
        }
        relationships.set(key, relationship)
        return relationship
      }),
    attachIdentifier: (input) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(AttachExternalIdentifierInput)(input)
        yield* authorization.authorize({
          principal: decoded.principal,
          tenantId: decoded.tenantId,
          capability: PartyCapabilities.partyIdentifierAttach,
        })
        if (stored.get(decoded.partyId)?.tenantId !== decoded.tenantId) {
          return yield* Effect.fail(
            new PartyNotFound({ tenantId: decoded.tenantId, partyId: decoded.partyId }),
          )
        }
        const provider = decoded.provider.trim().toUpperCase()
        const scheme = decoded.scheme.trim().toUpperCase()
        const scope = decoded.scope.trim()
        const legalEntityId = decoded.legalEntityId ?? null
        if (
          legalEntityId !== null &&
          (storedLegalEntities.get(legalEntityId)?.tenantId !== decoded.tenantId)
        ) {
          return yield* Effect.fail(
            new LegalEntityNotFound({ tenantId: decoded.tenantId, legalEntityId }),
          )
        }
        const value = decoded.value.trim()
        const key = `${decoded.tenantId}:${provider}:${scheme}:${scope}:${
          legalEntityId ?? "tenant"
        }:${value}`
        if (identifiers.has(key)) {
          return yield* Effect.fail(
            new ExternalIdentifierAlreadyAssigned({
              tenantId: decoded.tenantId,
              provider,
              scheme,
              scope,
              legalEntityId,
              value,
            }),
          )
        }
        identifiers.add(key)
        return {
          id: nextId(),
          tenantId: decoded.tenantId,
          partyId: decoded.partyId,
          provider,
          scheme,
          scope,
          legalEntityId,
          value,
        }
      }),
      }

      return service
    }),
  )
