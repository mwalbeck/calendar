/**
 * @copyright Copyright (c) 2019 Georg Ehrke
 *
 * @author Georg Ehrke <oc.list@georgehrke.com>
 *
 * @license GNU AGPL version 3 or any later version
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 *
 */
import getTimezoneManager from '../../services/timezoneDataProviderService.js'
import {createFreeBusyRequest, getParserManager} from 'calendar-js'
import DateTimeValue from 'calendar-js/src/values/dateTimeValue.js'
import {findSchedulingOutbox} from '../../services/caldavService.js'
import freeBusyResourceEventSourceFunction from './freeBusyResourceEventSourceFunction.js'
import logger from '../../utils/logger.js'
import {getColorForFBType} from "../../utils/freebusy";
// import AttendeeProperty from 'calendar-js/src/properties/attendeeProperty.js'

/**
 * Returns an event source for free-busy
 *
 * @param {AttendeeProperty} organizer The organizer of the event
 * @param {AttendeeProperty[]} attendees Array of the event's attendees
 * @param {String[]} resources List of resources
 * @returns {{startEditable: boolean, resourceEditable: boolean, editable: boolean, id: string, durationEditable: boolean, events: events}}
 */
export default function (organizer, attendees, resources) {
	const resourceIds = resources.map((resource) => resource.id)

	return {
		id: 'free-busy-free-for-all',
		editable: false,
		startEditable: false,
		durationEditable: false,
		resourceEditable: false,
		events: async ({
						   start,
						   end,
						   timeZone
					   }, successCallback, failureCallback) => {
			console.debug('freeBusyBlockedForAllEventSource', start, end, timeZone)

			let timezoneObject = getTimezoneManager().getTimezoneForId(timeZone)
			if (!timezoneObject) {
				timezoneObject = getTimezoneManager().getTimezoneForId('UTC')
				logger.error(`FreeBusyEventSource: Timezone ${timeZone} not found, falling back to UTC.`)
			}

			const startDateTime = DateTimeValue.fromJSDate(start, true)
			const endDateTime = DateTimeValue.fromJSDate(end, true)

			// const organizerAsAttendee = new AttendeeProperty('ATTENDEE', organizer.email)
			const freeBusyComponent = createFreeBusyRequest(startDateTime, endDateTime, organizer, attendees)
			const freeBusyICS = freeBusyComponent.toICS()

			let outbox
			try {
				outbox = await findSchedulingOutbox()
			} catch (error) {
				failureCallback(error)
				return
			}

			let freeBusyData
			try {
				freeBusyData = await outbox.freeBusyRequest(freeBusyICS)
			} catch (error) {
				failureCallback(error)
				return
			}

			const events = []
			for (const [uri, data] of Object.entries(freeBusyData)) {
				if (!data.success) {
					continue;
				}

				const parserManager = getParserManager()
				const parser = parserManager.getParserForFileType('text/calendar')
				parser.parse(data.calendarData)

				// TODO: fix me upstream, parser only exports VEVENT, VJOURNAL and VTODO at the moment
				const calendarComponent = parser._calendarComponent
				const freeBusyComponent = calendarComponent.getFirstComponent('VFREEBUSY')
				if (!freeBusyComponent) {
					continue;
				}

				for (const freeBusyProperty of freeBusyComponent.getPropertyIterator('FREEBUSY')) {
					const eventStart = freeBusyProperty.getFirstValue().start.getInTimezone(timezoneObject).jsDate.toISOString()
					const eventEnd = freeBusyProperty.getFirstValue().end.getInTimezone(timezoneObject).jsDate.toISOString()

					// TODO: prevent overlaps
					events.push({
						groupId: Math.random().toString(36).substring(7),
						start: eventStart,
						end: eventEnd,
						resourceIds: resourceIds,
						display: 'background',
						allDay: false,
						backgroundColor: 'lightgrey',
						borderColor: 'lightgrey',
					})
				}
			}

			console.debug('freeBusyBlockedForAllEventSource', events)

			successCallback(events)
		},
	}
}
