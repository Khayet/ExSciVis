#version 150
//#extension GL_ARB_shading_language_420pack : require
#extension GL_ARB_explicit_attrib_location : require

#define TASK 10
#define ENABLE_OPACITY_CORRECTION 0
#define ENABLE_LIGHTNING 0
#define ENABLE_SHADOWING 0
#define FRONT_TO_BACK 1

in vec3 ray_entry_position;

layout(location = 0) out vec4 FragColor;

uniform mat4 Modelview;

uniform sampler3D volume_texture;
uniform sampler2D transfer_texture;


uniform vec3    camera_location;
uniform float   sampling_distance;
uniform float   sampling_distance_ref;
uniform float   iso_value;
uniform vec3    max_bounds;
uniform ivec3   volume_dimensions;

uniform vec3    light_position;
uniform vec3    light_ambient_color;
uniform vec3    light_diffuse_color;
uniform vec3    light_specular_color;
uniform float   light_ref_coef;


bool
inside_volume_bounds(const in vec3 sampling_position)
{
    return (   all(greaterThanEqual(sampling_position, vec3(0.0)))
            && all(lessThanEqual(sampling_position, max_bounds)));
}


float
get_sample_data(vec3 in_sampling_pos)
{
    vec3 obj_to_tex = vec3(1.0) / max_bounds;
    return texture(volume_texture, in_sampling_pos * obj_to_tex).r;

}

vec3
get_gradient(vec3 in_sampling_pos)
{
    /*
     * The gradient is the direction of the steepest ascend.
     * -->
     * The surface gradients of the skull should all point inward
     * and the surface normals should simply be negative gradients.
     */

    float dx = max_bounds.x / float(volume_dimensions.x);
    float dy = max_bounds.y / float(volume_dimensions.y);
    float dz = max_bounds.z / float(volume_dimensions.z);

    float x = in_sampling_pos.x;
    float y = in_sampling_pos.y;
    float z = in_sampling_pos.z;

    // central density difference of neighboring voxels
    return vec3(get_sample_data(vec3(x+dx, y, z)) - get_sample_data(vec3(x-dx, y, z)),
                get_sample_data(vec3(x, y+dy, z)) - get_sample_data(vec3(x, y-dy, z)),
                get_sample_data(vec3(x, y, z+dz)) - get_sample_data(vec3(x, y, z-dz)));
}

vec4
shade(vec3 in_sampling_pos, vec3 normal, vec3 light_vec)
{
    // diffuse:
    vec3 diffuse = light_diffuse_color * clamp(dot(normal, light_vec), 0.0, 1.0);

    // specular:
    vec3 camera_vec = camera_location - in_sampling_pos;
    vec3 halfway = normalize(light_vec + camera_vec);
    vec3 specular = light_specular_color * pow(clamp(dot(normal, halfway), 0.0, 1.0), light_ref_coef);

    return vec4(light_ambient_color + diffuse + specular, 1.0);
}


void main()
{
    /// One step trough the volume
    vec3 ray_increment      = normalize(ray_entry_position - camera_location) * sampling_distance;
    /// Position in Volume
    vec3 sampling_pos       = ray_entry_position + ray_increment; // test, increment just to be sure we are in the volume

    /// Init color of fragment
    vec4 dst = vec4(0.0, 0.0, 0.0, 0.0);

    /// check if we are inside volume
    bool inside_volume = inside_volume_bounds(sampling_pos);

    if (!inside_volume)
        discard;

#if TASK == 10
    vec4 max_val = vec4(0.0, 0.0, 0.0, 0.0);


    // the traversal loop,
    // termination when the sampling position is outside volume boundarys
    // another termination condition for early ray termination is added
    while (inside_volume)
    {
        // get sample
        float s = get_sample_data(sampling_pos);

        // apply the transfer functions to retrieve color and opacity
        vec4 color = texture(transfer_texture, vec2(s, s));

        // this is the example for maximum intensity projection
        max_val.r = max(color.r, max_val.r);
        max_val.g = max(color.g, max_val.g);
        max_val.b = max(color.b, max_val.b);
        max_val.a = max(color.a, max_val.a);

        // increment the ray sampling position
        sampling_pos  += ray_increment;

        // update the loop termination condition
        inside_volume  = inside_volume_bounds(sampling_pos);
    }

    dst = max_val;

#endif

#if TASK == 11
    vec3 sum_color = vec3(0.0, 0.0, 0.0);
    float sum_a = 0.0;
    int num = 0;

    // the traversal loop,
    // termination when the sampling position is outside volume boundarys
    // another termination condition for early ray termination is added
    while (inside_volume)
    {
        // get sample
        float s = get_sample_data(sampling_pos);

        // apply the transfer functions to retrieve color and opacity
        vec4 color = texture(transfer_texture, vec2(s, s));

        sum_a += color.a;
        sum_color += vec3(color);

        num += 1;

        // increment the ray sampling position
        sampling_pos  += ray_increment;

        // update the loop termination condition
        inside_volume  = inside_volume_bounds(sampling_pos);
    }


    dst = vec4(sum_color / sum_a, sum_a / num);

#endif

#if TASK == 12 || TASK == 13
    // the traversal loop,
    // termination when the sampling position is outside volume boundarys
    // another termination condition for early ray termination is added
    vec3 out_sampling_pos = vec3(0.0, 0.0, 0.0);

    while (inside_volume)
    {
        float s = get_sample_data(sampling_pos);

        if (s <= iso_value)
        {
            out_sampling_pos = sampling_pos;

            // increment the ray sampling position
            sampling_pos += ray_increment;

            // update the loop termination condition
            inside_volume = inside_volume_bounds(sampling_pos);
            continue;
        }

        dst = vec4(iso_value);

#if TASK == 13 // Binary Search

        while (length(out_sampling_pos - sampling_pos) > 0.01*sampling_distance)
        {
            vec3 between = (out_sampling_pos + sampling_pos) / 2.0;

            if (get_sample_data(between) > iso_value) {
                sampling_pos = between;
            } else {
                out_sampling_pos = between;
            }
        }

#endif
#if ENABLE_LIGHTNING == 1 // Add Shading

        vec3 gradient = get_gradient(sampling_pos);
        vec3 normal = -gradient;
        vec3 light_vec = light_position - sampling_pos;

        dst = shade(sampling_pos, normal, light_vec);


#if ENABLE_SHADOWING == 1 // Add Shadows
        
        // sampling_pos = sampling_pos + normal * 0.1;
        sampling_pos = sampling_pos + normalize(normal) * 0.01;
        
        vec3 sampling_to_light = normalize(light_vec) * sampling_distance;

        do
        {
            float s2 = get_sample_data(sampling_pos);
            sampling_pos += sampling_to_light;

            if (get_sample_data(sampling_pos) > iso_value)
            {
                dst = vec4(light_ambient_color, 1.0);
            }
        }
        while (get_sample_data(sampling_pos) <= iso_value && inside_volume_bounds(sampling_pos));

#endif
#endif

        break;
    }
#endif

#if TASK == 31

#if FRONT_TO_BACK == 1

    // vec3 inten = texture(transfer_texture, vec2(get_sample_data(sampling_pos), get_sample_data(sampling_pos))).rgb;
    vec3 inten = vec3(0.0);
    float trans = 1.0;

    float actual_sampling_distance = sampling_distance;
    while (inside_volume && trans > 0.01)
    {
        float s = get_sample_data(sampling_pos);
        vec4 color = texture(transfer_texture, vec2(s, s));

#if ENABLE_OPACITY_CORRECTION == 1 // Opacity Correction
        float correction = (sampling_distance / sampling_distance_ref) * 255;
        float alpha = 1 - pow(1 - color.a, correction);
        trans *= pow(1 - color.a, correction);
#else
        float alpha = color.a;
        // trans = 1 - alpha;
        trans *= 1 - alpha;

#endif // ENABLE_OPACITY_CORRECTION

#if ENABLE_LIGHTNING == 1 // Add Shading
        vec3 gradient = get_gradient(sampling_pos);
        vec3 normal = -gradient;
        vec3 light_vec = light_position - sampling_pos;

        vec3 local_intensity = 5.0 * color.rgb * alpha * shade(sampling_pos, normal, light_vec).rgb;

        // vec3 local_intensity = alpha * shade(sampling_pos, normal, light_vec).rgb;

#else
        vec3 local_intensity = color.rgb * alpha;
#endif
        inten += local_intensity * trans;

        sampling_pos += ray_increment;

        inside_volume = inside_volume_bounds(sampling_pos);
    }
    dst = vec4(inten, 1.0);

#endif // FRONT_TO_BACK == 1


#if FRONT_TO_BACK == 0 // BACK-TO-FRONT:
    
    while (inside_volume_bounds(sampling_pos))
    {
        sampling_pos += ray_increment;
    }

    vec3 inten = vec3(0.0);

    while (inside_volume)
    {
#if ENABLE_OPACITY_CORRECTION == 1 // Opacity Correction
        IMPLEMENT;
#else
        float s = get_sample_data(sampling_pos);
        vec4 color = texture(transfer_texture, vec2(s, s));
#endif
        vec3 local_intensity = color.rgb * color.a;
        inten = local_intensity + inten * (1 - color.a);

        // walk backwards along the ray
        sampling_pos -= ray_increment;

#if ENABLE_LIGHTNING == 1 // Add Shading
        IMPLEMENT;
#endif

        inside_volume = inside_volume_bounds(sampling_pos);
    }
    dst = vec4(inten, 1.0);

#endif // FRONT_TO_BACK == 0
#endif // TASK 31

    // return the calculated color value
    FragColor = dst;
}

