## ADDED Requirements

### Requirement: A notification whose gesture the app can no longer make SHALL keep working, and its type SHALL NOT be removed

Retiring the affordance that produced a notification SHALL NOT retire the notification. Rows already
delivered SHALL keep their copy, their actor, their subject and their destination, and the client
switches that render them SHALL remain exhaustive over every type the database can hold.

The fan-out triggers SHALL remain in place, because the table they hang off is unchanged by this
change; they simply have no caller in the app.

Removing the type is part of the destructive successor that drops the table, and that successor SHALL
account for rows already holding the value — the type appears in the notification table's constraints,
so removing it while rows carry it makes those constraints unvalidatable.

#### Scenario: A delivered wave notification still opens its thread
- **WHEN** a rider opens a notification recording a wave on their thread, delivered before this change
- **THEN** it SHALL render with its existing copy
- **AND** its destination SHALL open the thread it names

#### Scenario: No switch is narrowed
- **WHEN** this change is applied
- **THEN** every notification type SHALL still be handled by the client
- **AND** no case SHALL be deleted on the grounds that nothing writes it any more

#### Scenario: The deep link is the surviving route to an unlisted thread
- **WHEN** a notification names a thread that no browse surface lists
- **THEN** following it SHALL open that thread under the same policies as any other route to it
- **AND** the absence of a browse route SHALL NOT be treated as a permission decision
