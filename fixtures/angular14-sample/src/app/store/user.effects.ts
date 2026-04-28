import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { HttpClient } from '@angular/common/http';
import { map, switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { loadUsers, loadUsersSuccess, loadUsersFailure } from './user.actions';
import { User } from '../users/user-list.component';

@Injectable()
export class UserEffects {
  loadUsers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadUsers),
      switchMap(() =>
        this.http.get<User[]>('/api/users').pipe(
          map((users) => loadUsersSuccess({ users })),
          catchError((error: unknown) => of(loadUsersFailure({ error: String(error) })))
        )
      )
    )
  );

  constructor(private actions$: Actions, private http: HttpClient) {}
}
