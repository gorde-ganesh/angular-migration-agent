import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { User } from './user-list.component';

@Component({
  selector: 'app-user-card',
  template: `
    <div class="card" [class.active]="user.active">
      <h3>{{ user.name }}</h3>
      <p>{{ user.email }}</p>
      <span *ngIf="user.active; else inactive">Active</span>
      <ng-template #inactive>Inactive</ng-template>
      <button (click)="onDelete()">Delete</button>
    </div>
  `,
})
export class UserCardComponent implements OnChanges {
  @Input() user!: User;
  @Output() delete = new EventEmitter<number>();

  displayName = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['user']) {
      this.displayName = this.user.name.toUpperCase();
    }
  }

  onDelete(): void {
    this.delete.emit(this.user.id);
  }
}
