export {
  CreateUserAccountInput,
  UserAccount,
  UserAccountAlreadyExists,
  UserAccountNotFound,
  UserAccountService,
  UpdateUserAccountInput,
  makeUserAccountService,
  makeUserAccountTestLayer,
} from "./src/service.ts"
export type { UserAccountService as UserAccountServiceShape } from "./src/service.ts"
