import { createFeatureSelector, createSelector } from '@ngrx/store';
import { UserState, selectAllUsers as selectAll } from './user.reducer';

export const selectUserState = createFeatureSelector<UserState>('users');
export const selectAllUsers = createSelector(selectUserState, selectAll);
