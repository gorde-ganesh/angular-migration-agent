import { createAction, props } from '@ngrx/store';
import { User } from '../users/user-list.component';

export const loadUsers = createAction('[Users] Load Users');
export const loadUsersSuccess = createAction('[Users] Load Users Success', props<{ users: User[] }>());
export const loadUsersFailure = createAction('[Users] Load Users Failure', props<{ error: string }>());
export const deleteUser = createAction('[Users] Delete User', props<{ id: number }>());
