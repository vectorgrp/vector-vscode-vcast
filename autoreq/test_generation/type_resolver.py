import xml.etree.ElementTree as ET


class Type:
    """Base class for all types"""

    def __init__(self, name):
        self.name = name

    def __str__(self):
        return self.name

    def to_vectorcast_path(self, **kwargs):
        raise NotImplementedError()

    def to_vectorcast(self, *args, deduplicate=True, **kwargs):
        compiled_type = self.to_vectorcast_path(*args, **kwargs)
        finalized_identifiers = []
        for identifier in compiled_type:
            finalized_identifier = '.'.join(identifier).replace('.[', '[')

            if not deduplicate or finalized_identifier not in finalized_identifiers:
                finalized_identifiers.append(finalized_identifier)

        return finalized_identifiers


class BasicType(Type):
    """Represents primitive types like int, float, char"""

    def to_vectorcast_path(self, **kwargs):
        return [[]]


class PointerType(Type):
    """Represents a pointer to another type"""

    def __init__(self, name, pointed_type):
        super().__init__(name)
        self.pointed_type = pointed_type

    def to_vectorcast_path(self, **kwargs):
        compiled_pointed = self.pointed_type.to_vectorcast_path(**kwargs)
        compiled_pointer = []

        compiled_pointer.append([])

        for identifier in compiled_pointed:
            compiled_pointer.append(['[0]', *identifier])

        return compiled_pointer


class ArrayType(Type):
    """Represents an array of elements"""

    def __init__(self, name, element_type, size=None):
        super().__init__(name)
        self.element_type = element_type
        self.size = size

    def to_vectorcast_path(self, **kwargs):
        compiled_array = []

        for idx in range(self.size or 4):
            compiled_element = self.element_type.to_vectorcast_path(**kwargs)
            for identifier in compiled_element:
                compiled_array.append([f'[{idx}]', *identifier])

        return compiled_array


class StringType(Type):
    """Represents a string type (char array)"""

    def __init__(self, name, size=None):
        super().__init__(name)
        self.size = size

    def to_vectorcast_path(self, **kwargs):
        return [[]]


class StructType(Type):
    """Represents a struct with fields"""

    def __init__(self, name, fields=None):
        super().__init__(name)
        self.fields = fields or []  # List of Identifiers representing fields

    def to_vectorcast_path(self, **kwargs):
        compiled_struct = []
        for field in self.fields:
            compiled_field = field.type.to_vectorcast_path(**kwargs)
            for identifier in compiled_field:
                compiled_struct.append([field.name, *identifier])

        return compiled_struct


class ClassType(Type):
    """Represents a C++ class with fields and constructors"""

    def __init__(self, name, fields=None, constructors=None):
        super().__init__(name)
        self.fields = fields or []  # List of Identifiers representing fields
        self.constructors = constructors or []  # List of constructor information

    def to_vectorcast_path(self, parent_already_constructed=False, **kwargs):
        compiled_class = []

        # Add constructor call if constructors exist and flag is True
        if not parent_already_constructed:
            # Add class allocation identifier with (cl) prefix for global class instances
            compiled_class.append([])

            for constructor in self.constructors:
                constructor_name = constructor.get('name', '')
                compiled_class.append(
                    # [self.name, '<<constructor>>', f'{func_name}()', '<<call>>']
                    [self.name, '<<constructor>>', constructor_name, '<<call>>']
                )

        # Add fields
        for field in self.fields:
            compiled_field = field.type.to_vectorcast_path(
                **kwargs, parent_already_constructed=True
            )
            for identifier in compiled_field:
                compiled_class.append([self.name, field.name, *identifier])

        return compiled_class


class EnumType(BasicType):
    """Represents an enumeration type"""

    def __init__(self, name, values=None):
        super().__init__(name)
        self.values = values or []  # List of enum values


class Identifier:
    """Unified class for parameters, globals, and called functions"""

    def __init__(self, name, type_info):
        self.name = name
        self.type = type_info

    def __str__(self):
        return f'{self.name}: {self.type}'


class FunctionType(Type):
    """Represents a function type with all associated information"""

    def __init__(self, name):
        super().__init__(name)
        self.parameters = []  # List of Identifiers
        self.return_type = None  # Type of return value
        self.globals = []  # List of Identifiers
        self.called_functions = []  # List of Identifiers
        self.unit = None  # The unit this function belongs to
        self.origin_class = (
            None  # ClassType if this is a member function, None otherwise
        )

    def to_vectorcast_path(self, **kwargs):
        param_prefix = [self.unit, self.name]
        global_prefix = [self.unit, '<<GLOBAL>>']

        compiled_function = []
        if self.origin_class is not None:
            compiled_class = self.origin_class.to_vectorcast_path(**kwargs)
            for identifier in compiled_class:
                compiled_function.append(
                    [*global_prefix, '(cl)', self.origin_class.name, *identifier]
                )

        for g in self.globals:
            compiled_global = g.type.to_vectorcast_path(**kwargs)

            # Handle class instances with (cl) prefix
            if isinstance(g.type, ClassType):
                for identifier in compiled_global:
                    compiled_function.append(
                        [*global_prefix, '(cl)', g.name, *identifier]
                    )
            else:
                for identifier in compiled_global:
                    compiled_function.append([*global_prefix, g.name, *identifier])

        for param in self.parameters:
            compiled_param = param.type.to_vectorcast_path(**kwargs)
            for identifier in compiled_param:
                compiled_function.append([*param_prefix, param.name, *identifier])

        if self.return_type:
            compiled_return = self.return_type.to_vectorcast_path(**kwargs)
            for identifier in compiled_return:
                compiled_function.append([*param_prefix, 'return', *identifier])

        for called_func in self.called_functions:
            compiled_called_func = called_func.type.to_vectorcast_path(**kwargs)
            compiled_function.extend(compiled_called_func)

        return compiled_function


class TypeResolver:
    """Helper class to parse XML files and extract identifier information"""

    def __init__(self, param_file_path, types_file_path):
        self.param_file_path = param_file_path
        self.types_file_path = types_file_path
        self._types = {}  # Cache for type information
        self._type_elements = {}  # Original XML elements for deferred processing
        self._functions = {}  # Cache for function information
        self._parse_files()

    def _parse_files(self):
        # Parse the types XML file
        self._parse_types_file()

        # Parse the param XML file
        self._parse_param_file()

    def _parse_types_file(self):
        """Parse types.xml to extract type definitions"""
        types_tree = ET.parse(self.types_file_path)
        types_root = types_tree.getroot()

        # First pass: Store all type elements and create basic type objects
        self._create_basic_types(types_root)

        # Second pass: Resolve references between types
        self._resolve_type_references()

    def _create_basic_types(self, types_root):
        """Create basic type objects from XML elements"""
        for type_elem in types_root.findall('type'):
            type_id = type_elem.get('typeid')
            type_name = type_elem.get('typemark')
            type_type = type_elem.get('typetype')

            # Store the element for later processing
            self._type_elements[type_id] = type_elem

            # Create basic type objects
            type_mapping = {
                'ACCE_SS': lambda: PointerType(type_name, None),
                'AR_RAY': lambda: ArrayType(type_name, None, None),
                'STR_ING': lambda: StringType(type_name, None),
                'REC_ORD': lambda: StructType(type_name),
                'UNION': lambda: StructType(type_name),  # Union treated as struct
                'CLASS': lambda: ClassType(type_name),
                'CLASS_PTR': lambda: PointerType(type_name, None),
                'ENUMERATION': lambda: EnumType(type_name),
            }

            if type_type in type_mapping:
                self._types[type_id] = type_mapping[type_type]()
            else:
                self._types[type_id] = BasicType(type_name)

    def _resolve_type_references(self):
        """Resolve references between types in second pass"""
        for type_id, type_elem in self._type_elements.items():
            type_type = type_elem.get('typetype')

            if type_type == 'ACCE_SS':
                self._resolve_pointer_type(type_id, type_elem)
            elif type_type == 'AR_RAY':
                self._resolve_array_type(type_id, type_elem)
            elif type_type in {'REC_ORD', 'UNION'}:
                self._resolve_struct_type(type_id, type_elem)
            elif type_type == 'CLASS':
                self._resolve_class_type(type_id, type_elem)
            elif type_type == 'CLASS_PTR':
                self._resolve_pointer_type(type_id, type_elem)
            elif type_type == 'ENUMERATION':
                self._resolve_enum_type(type_id, type_elem)

    def _resolve_pointer_type(self, type_id, type_elem):
        """Resolve pointer type references"""
        pointer_type = self._types[type_id]
        if not isinstance(pointer_type, PointerType):
            return

        pointer_type_id = type_elem.get('pointer_type')
        if pointer_type_id in self._types:
            pointer_type.pointed_type = self._types[pointer_type_id]
        else:
            pointer_type.pointed_type = Type('unknown')

    def _resolve_array_type(self, type_id, type_elem):
        """Resolve array type references"""
        array_type = self._types[type_id]
        if not isinstance(array_type, ArrayType):
            return

        array_type_id = type_elem.get('array_type')
        size = None
        range_data = type_elem.find('range_data')
        if range_data is not None:
            size_str = range_data.get('size')
            if size_str and size_str.endswith('%%'):
                size = int(size_str[:-2])

        if array_type_id in self._types:
            array_type.element_type = self._types[array_type_id]
            array_type.size = size
        else:
            array_type.element_type = Type('unknown')

    def _resolve_struct_type(self, type_id, type_elem):
        """Resolve struct type references and add fields"""
        struct_type = self._types[type_id]
        if not isinstance(struct_type, StructType):
            return

        # Create field identifiers instead of a dictionary
        for field in type_elem.findall('field'):
            field_name = field.get('name')
            field_type_id = field.get('typeid')
            if field_type_id in self._types:
                field_type = self._types[field_type_id]
            else:
                field_type = Type('unknown')

            struct_type.fields.append(Identifier(field_name, field_type))

    def _resolve_class_type(self, type_id, type_elem):
        """Resolve class type references and add fields and constructors"""
        class_type = self._types[type_id]
        if not isinstance(class_type, ClassType):
            return

        # Add constructors
        for constructor in type_elem.findall('constructor'):
            constructor_prog = constructor.find('subprog')
            constructor_name = constructor_prog.get('name').split('::')[-1]
            constructor_name += constructor_prog.get('parameterization', '')

            constructor_info = {
                'name': constructor_name,
                'index': constructor.get('index'),
            }
            class_type.constructors.append(constructor_info)

        # Add fields
        for field in type_elem.findall('field'):
            field_name = field.get('name')
            field_type_id = field.get('typeid')
            if field_type_id in self._types:
                field_type = self._types[field_type_id]
            else:
                field_type = Type('unknown')

            class_type.fields.append(Identifier(field_name, field_type))

    def _resolve_enum_type(self, type_id, type_elem):
        """Resolve enum type and add values"""
        enum_type = self._types[type_id]
        if not isinstance(enum_type, EnumType):
            return

        for enum_value in type_elem.findall('enum'):
            value_name = enum_value.get('value')
            enum_type.values.append(value_name)

    def _parse_param_file(self):
        """Parse param.xml to extract function and parameter information"""
        param_tree = ET.parse(self.param_file_path)
        param_root = param_tree.getroot()

        # Break down into smaller, focused operations
        unit_function_map = self._build_unit_function_map(param_root)
        units_globals_map = self._build_units_globals_map(param_root)
        self._process_function_definitions(param_root, units_globals_map)
        self._process_called_functions(param_root, unit_function_map)

    def _build_unit_function_map(self, param_root):
        """Build a map of all functions in all units for cross-referencing"""
        unit_function_map = {}  # Maps unit_index -> { function_index -> function_name }

        for unit in param_root.findall('unit'):
            unit_index = unit.get('index')
            unit_function_map[unit_index] = {}

            for subprog in unit.findall('subprog'):
                subprog_index = subprog.get('index')
                subprog_name = subprog.get('name')
                unit_function_map[unit_index][subprog_index] = subprog_name

                # Create the basic function object first
                if subprog_name not in self._functions:
                    self._functions[subprog_name] = FunctionType(subprog_name)

        return unit_function_map

    def _build_units_globals_map(self, param_root):
        """Build a map of global indices to globals for each unit"""
        units_globals_map = {}

        for unit in param_root.findall('unit'):
            unit_index = unit.get('index')
            globals_map = {}

            for global_elem in unit.findall('global'):
                global_idx = global_elem.get('index')
                global_name = global_elem.get('name')
                global_type_id = global_elem.get('typeid')
                if global_type_id in self._types:
                    globals_map[global_idx] = (global_name, self._types[global_type_id])

            units_globals_map[unit_index] = globals_map

        return units_globals_map

    def _process_function_definitions(self, param_root, units_globals_map):
        """Process functions and populate their details (parameters, globals, etc.)"""
        for unit in param_root.findall('unit'):
            unit_index = unit.get('index')
            globals_map = units_globals_map.get(unit_index, {})

            for subprog in unit.findall('subprog'):
                self._process_single_function(unit, subprog, globals_map)

    def _process_single_function(self, unit, subprog, globals_map):
        """Process a single function and populate its details"""
        func_name = subprog.get('name')

        # Get the existing function object or create a new one
        func_type = self._functions.get(func_name)
        if func_type is None:
            func_type = FunctionType(func_name)
            self._functions[func_name] = func_type

        # Set the unit this function belongs to
        func_type.unit = unit.get('name')

        # Set the origin class if this is a member function
        self._set_function_origin_class(func_type, subprog)

        # Extract parameters and return type
        self._extract_function_parameters(func_type, subprog)

        # Extract globals referenced by this function
        self._extract_function_globals(func_type, subprog, globals_map)

    def _set_function_origin_class(self, func_type, subprog):
        """Set the origin class if this is a member function"""
        subprog_typeid = subprog.get('typeid')
        if subprog_typeid and subprog_typeid in self._types:
            origin_type = self._types[subprog_typeid]
            # Check if it's a pointer to a class or a class itself
            if isinstance(origin_type, PointerType) and isinstance(
                origin_type.pointed_type, ClassType
            ):
                func_type.origin_class = origin_type.pointed_type
            elif isinstance(origin_type, ClassType):
                func_type.origin_class = origin_type

    def _extract_function_parameters(self, func_type, subprog):
        """Extract parameters and return type from a function"""
        for param in subprog.findall('param'):
            param_name = param.get('name')
            param_type_id = param.get('typeid')
            param_type = self._types.get(param_type_id, Type('unknown'))

            if param_name == 'return':
                func_type.return_type = param_type
            else:
                func_type.parameters.append(Identifier(param_name, param_type))

    def _extract_function_globals(self, func_type, subprog, globals_map):
        """Extract globals referenced by a function"""
        for global_ref in subprog.findall('global'):
            global_idx = global_ref.get('index')
            if global_idx in globals_map:
                global_name, global_type = globals_map[global_idx]
                func_type.globals.append(Identifier(global_name, global_type))

    def _process_called_functions(self, param_root, unit_function_map):
        """Process called functions using the fully populated function objects"""
        for unit in param_root.findall('unit'):
            for subprog in unit.findall('subprog'):
                func_name = subprog.get('name')
                func_type = self._functions.get(func_name)

                if func_type is None:
                    continue

                self._extract_called_functions(func_type, subprog, unit_function_map)

    def _extract_called_functions(self, func_type, subprog, unit_function_map):
        """Extract called functions for a specific function"""
        for func_call in subprog.findall('function'):
            called_unit = func_call.get('unit')
            called_idx = func_call.get('index')

            # Try to get the actual function name using the unit_function_map
            called_func_name = f'func_{called_unit}_{called_idx}'
            if (
                called_unit in unit_function_map
                and called_idx in unit_function_map[called_unit]
            ):
                called_func_name = unit_function_map[called_unit][called_idx]

            # Use the existing function object if available, otherwise create a placeholder
            if called_func_name in self._functions:
                called_func = self._functions[called_func_name]
            else:
                # Create a placeholder function
                called_func = FunctionType(f'function_{called_func_name}')
                self._functions[called_func_name] = called_func

            func_type.called_functions.append(Identifier(called_func_name, called_func))

    def resolve_function_by_name(self, function_name):
        """Get information about a specific function"""
        return self._functions.get(function_name)

    def resolve_type_by_id(self, type_id):
        """Get information about a specific type by its ID"""
        return self._types.get(type_id)

    def resolve_type_by_name(self, type_name):
        """Get information about a specific type by its name"""
        for type_obj in self._types.values():
            if type_obj.name == type_name:
                return type_obj
        return None

    def resolve(self, identifier):
        """Resolve any type of object (function or type).

        Args:
            identifier: The identifier of the object to resolve.
            kind: The kind of object, either "function", "type_id", or "type_name".

        Returns:
            The resolved object or None if not found.
        """
        res = self.resolve_function_by_name(identifier)
        if res is not None:
            return res

        res = self.resolve_type_by_name(identifier)
        if res is not None:
            return res

        return self.resolve_type_by_id(identifier)
