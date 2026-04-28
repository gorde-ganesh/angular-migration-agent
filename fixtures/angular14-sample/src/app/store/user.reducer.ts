import { createReducer, on } from '@ngrx/store';
import { EntityState, createEntityAdapter } from '@ngrx/entity';
import { User } from '../users/user-list.component';
import { loadUsersSuccess, deleteUser } from './user.actions';

export interface UserState extends EntityState<User> {
  loading: boolean;
}

const adapter = createEntityAdapter<User>();

const initialState: UserState = adapter.getInitialState({ loading: false });

export const userReducer = createReducer(
  initialState,
  on(loadUsersSuccess, (state, { users }) => adapter.setAll(users, { ...state, loading: false })),
  on(deleteUser, (state, { id }) => adapter.removeOne(id, state))
);

export const { selectAll: selectAllUsers } = adapter.getSelectors();
