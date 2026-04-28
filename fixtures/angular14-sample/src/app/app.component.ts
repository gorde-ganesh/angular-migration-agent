import { Component, Input, OnChanges, SimpleChanges, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent implements OnChanges {
  @Input() title: string = 'angular14-sample';
  @Input() showHeader: boolean = true;
  @Output() titleChanged = new EventEmitter<string>();

  isLoading = false;
  items: string[] = ['Angular', 'TypeScript', 'NgRx'];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['title']) {
      this.titleChanged.emit(this.title);
    }
  }

  trackByIndex(index: number): number {
    return index;
  }
}
