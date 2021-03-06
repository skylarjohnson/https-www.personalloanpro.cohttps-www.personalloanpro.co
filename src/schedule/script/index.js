import createSchedule from './create-schedule';
import * as styles from 'classnames:schedule/style.css';
import { utcOffset as venueOffset, path } from 'confbox-config:';
import {
  onChange,
  get as getTimezoneOption,
  localOffset,
} from '../../_includes/timezone-toggle/script/option';

const el = document.querySelector('.' + styles.scheduleBlock);

function render() {
  const offset = getTimezoneOption() === 'venue' ? venueOffset : localOffset;
  el.innerHTML = createSchedule(self.schedule, offset, styles, path);
}

onChange(render);

if (getTimezoneOption() !== 'venue') {
  render();
  el.style.visibility = 'visible';
}
