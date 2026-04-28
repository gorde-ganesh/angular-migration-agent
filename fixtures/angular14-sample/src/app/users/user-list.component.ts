import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { selectAllUsers } from '../store/user.selectors';
import { loadUsers, deleteUser } from '../store/user.actions';

export interface User {
  id: number;
  name: string;
  email: string;
  active: boolean;
}

@Component({
  selector: 'app-user-list',
  template: `
    <div *ngIf="loading">Loading users...</div>
    <ul *ngIf="!loading">
      <li *ngFor="let user of users$ | async; trackBy: trackById">
        <app-user-card
          [user]="user"
          (delete)="onDelete($event)"
          *ngIf="user.active"
        ></app-user-card>
      </li>
    </ul>
    <p *ngIf="(users$ | async)?.length === 0">No users found.</p>
  `,
})
export class UserListComponent implements OnInit {
  @Input() loading = false;
  @Output() userDeleted = new EventEmitter<number>();

  users$!: Observable<User[]>;

  constructor(private store: Store) {}

  ngOnInit(): void {
    this.users$ = this.store.select(selectAllUsers);
    this.store.dispatch(loadUsers());
  }

  trackById(index: number, user: User): number {
    return user.id;
  }

  onDelete(userId: number): void {
    this.store.dispatch(deleteUser({ id: userId }));
    this.userDeleted.emit(userId);
  }
}
